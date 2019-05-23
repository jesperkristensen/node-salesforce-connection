"use strict";
let https = require("https");
let querystring = require("querystring");
let XML = require("./xml");

// See README.md for documentation.
class SalesforceConnection {
  constructor() {
    this.instanceHostname = null;
    this.sessionId = null;
  }

  async soapLogin({hostname, apiVersion, username, password}) {
    this.instanceHostname = hostname;
    this.sessionId = null;
    let wsdl = this.wsdl(apiVersion, "Partner");
    let loginResult = await this.soap(wsdl, "login", {username, password});
    let {serverUrl, sessionId} = loginResult;
    serverUrl = /https:\/\/(.*)\/services/.exec(serverUrl)[1];
    if (!serverUrl || !sessionId) {
      // This should hever happen
      let err = new Error("Salesforce didn't return a serverUrl and sessionId");
      err.detail = loginResult;
      throw err;
    }
    this.instanceHostname = serverUrl;
    this.sessionId = sessionId;
    return loginResult;
  }

  async oauthToken(hostname, tokenRequest) {
    this.instanceHostname = hostname;
    this.sessionId = null;
    let token = await this.rest("/services/oauth2/token", {method: "POST", body: tokenRequest, bodyType: "urlencoded"});
    let {instance_url, access_token} = token;
    instance_url = instance_url.replace("https://", "");
    if (!instance_url || !access_token) {
      // This should hever happen
      let err = new Error("Salesforce didn't return an instance_url and access_token");
      err.detail = token;
      throw err;
    }
    this.instanceHostname = instance_url;
    this.sessionId = access_token;
    return token;
  }

  async rest(path, {method = "GET", api = "normal", body = undefined, bodyType = "json", headers: argHeaders = {}, responseType = "json"} = {}) {
    let host = this.instanceHostname;
    let headers = {};

    if (responseType == "json") {
      headers.Accept = "application/json; charset=UTF-8";
    } else if (responseType == "raw") {
      // Do nothing
    } else {
      throw new Error("Unknown responseType");
    }

    if (this.sessionId) {
      if (api == "bulk") {
        headers["X-SFDC-Session"] = this.sessionId;
      } else if (api == "normal") {
        headers.Authorization = "Bearer " + this.sessionId;
      } else {
        throw new Error("Unknown api");
      }
    }

    if (body !== undefined) {
      if (bodyType == "json") {
        body = JSON.stringify(body);
        headers["Content-Type"] = "application/json; charset=UTF-8";
      } else if (bodyType == "urlencoded") {
        body = querystring.stringify(body);
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      } else if (bodyType == "raw") {
        // Do nothing
      } else {
        throw new Error("Unknown bodyType");
      }
    }

    Object.assign(headers, argHeaders); // argHeaders take priority over headers

    let response = await this._request({host, path, method, headers}, body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (responseType == "json") {
        if (response.body.length > 0) {
          return JSON.parse(response.body.toString());
        }
        return null;
      } else {
        return response;
      }
    } else {
      let err = new Error();
      err.name = "SalesforceRestError";
      if (responseType == "json") {
        try {
          err.detail = JSON.parse(response.body.toString());
        } catch (ex) {
          err.detail = null;
        }
        try {
          err.message = err.detail.map(err => `${err.errorCode}: ${err.message}${err.fields && err.fields.length > 0 ? ` [${err.fields.join(", ")}]` : ""}`).join("\n");
        } catch (ex) {
          if (response.body.length > 0) {
            err.message = response.body.toString();
          } else {
            err.message = "HTTP error " + response.statusCode + " " + response.statusMessage;
          }
        }
      } else {
        err.detail = response;
        err.message = "HTTP error " + response.statusCode + " " + response.statusMessage;
      }
      err.response = response;
      throw err;
    }
  }

  wsdl(apiVersion, apiName) {
    let wsdl = {
      Enterprise: {
        servicePortAddress: "/services/Soap/c/" + apiVersion,
        targetNamespaces: ' xmlns="urn:enterprise.soap.sforce.com" xmlns:sf="urn:sobject.enterprise.soap.sforce.com"'
      },
      Partner: {
        servicePortAddress: "/services/Soap/u/" + apiVersion,
        targetNamespaces: ' xmlns="urn:partner.soap.sforce.com" xmlns:sf="urn:sobject.partner.soap.sforce.com"'
      },
      Apex: {
        servicePortAddress: "/services/Soap/s/" + apiVersion,
        targetNamespaces: ' xmlns="http://soap.sforce.com/2006/08/apex"'
      },
      Metadata: {
        servicePortAddress: "/services/Soap/m/" + apiVersion,
        targetNamespaces: ' xmlns="http://soap.sforce.com/2006/04/metadata"'
      },
      Tooling: {
        servicePortAddress: "/services/Soap/T/" + apiVersion,
        targetNamespaces: ' xmlns="urn:tooling.soap.sforce.com" xmlns:sf="urn:sobject.tooling.soap.sforce.com" xmlns:mns="urn:metadata.tooling.soap.sforce.com"'
      }
    };
    if (apiName) {
      wsdl = wsdl[apiName];
    }
    return wsdl;
  }

  async soap(wsdl, method, args, {headers} = {}) {
    let httpsOptions = {
      host: this.instanceHostname,
      path: wsdl.servicePortAddress,
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "SOAPAction": '""'
      }
    };
    let sessionHeader = null;
    if (this.sessionId) {
      sessionHeader = {SessionHeader: {sessionId: this.sessionId}};
    }
    let requestBody = XML.stringify({
      name: "soapenv:Envelope",
      attributes: ' xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' + wsdl.targetNamespaces,
      value: {
        "soapenv:Header": Object.assign({}, sessionHeader, headers),
        "soapenv:Body": {[method]: args}
      }
    });
    let response = await this._request(httpsOptions, requestBody);
    let resBody = XML.parse(response.body.toString()).value["soapenv:Body"];
    if (response.statusCode == 200) {
      return resBody[method + "Response"].result;
    } else {
      let err = new Error();
      err.name = "SalesforceSoapError";
      err.message = resBody["soapenv:Fault"].faultstring;
      err.detail = resBody["soapenv:Fault"];
      err.response = response;
      throw err;
    }
  }

  _request(httpsOptions, requestBody) {
    return new Promise((resolve, reject) => {
      let req = https.request(httpsOptions, response => {
        let chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            headers: response.headers,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            body: Buffer.concat(chunks)
          });
        });
        response.on("error", reject);
      });
      req.on("error", reject);
      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    });
  }

}

SalesforceConnection.prototype.asArray = XML.asArray;

module.exports = SalesforceConnection;
