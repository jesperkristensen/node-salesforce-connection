"use strict";
let https = require("https");
let urlEncoder = require("./urlencoder");
let xmlParser = require("./xmlparser");
let xmlBuilder = require("./xmlbuilder");

// See README.md for documentation.
class SalesforceConnection {
  constructor() {
    this.instanceHostname = null;
    this.sessionId = null;
  }

  soapLogin({hostname, apiVersion, username, password}) {
    this.instanceHostname = hostname;
    this.sessionId = null;
    let wsdl = this.wsdl(apiVersion, "Partner");
    return this.soap(wsdl, "login", {username, password})
      .then(loginResult => {
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
      });
  }

  oauthToken(hostname, tokenRequest) {
    this.instanceHostname = hostname;
    this.sessionId = null;
    return this.rest("/services/oauth2/token", {method: "POST", body: tokenRequest, bodyType: "urlencoded"})
      .then(token => {
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
      });
  }

  rest(path, {method = "GET", api = "normal", body = undefined, bodyType = "json", headers: argHeaders = {}, responseType = "json"} = {}) {
    let host = this.instanceHostname;
    let headers = {};
    if (responseType == "json") {
      headers.Accept = "application/json; charset=UTF-8";
    } else {
      headers.Accept = responseType;
    }
    if (api == "bulk") {
      headers["X-SFDC-Session"] = this.sessionId;
    } else {
      headers.Authorization = "Bearer " + this.sessionId;
    }
    if (body !== undefined) {
      if (bodyType == "json") {
        body = JSON.stringify(body);
        bodyType = "application/json; charset=UTF-8";
      } else if (bodyType == "urlencoded") {
        body = urlEncoder(body);
        bodyType = "application/x-www-form-urlencoded; charset=UTF-8";
      }
      headers["Content-Type"] = bodyType;
    }
    Object.assign(headers, argHeaders); // argHeaders take priority over headers
    return this._request({host, path, method, headers}, body).then(({response, responseBody}) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (responseType == "json") {
          if (responseBody) {
            return JSON.parse(responseBody);
          }
          return null;
        } else {
          return responseBody;
        }
      } else {
        let err = new Error();
        err.name = "SalesforceRestError";
        err.detail = null;
        try {
          if (responseType == "json") {
            err.detail = JSON.parse(responseBody);
            err.message = err.detail.map(err => err.errorCode + ": " + err.message).join("\n");
          } else {
            err.message = responseBody;
            err.detail = responseBody;
          }
        } catch (ex) {
          // empty
        }
        if (!err.message) {
          err.message = "HTTP error " + response.statusCode + " " + response.statusMessage + (responseBody ? "\n\n" + responseBody : "");
        }
        err.response = response;
        err.responseBody = responseBody;
        throw err;
      }
    });
  }

  wsdl(apiVersion, apiName) {
    let wsdl = {
      Enterprise: {
        servicePortAddress: "/services/Soap/c/" + apiVersion,
        targetNamespace: "urn:enterprise.soap.sforce.com"
      },
      Partner: {
        servicePortAddress: "/services/Soap/u/" + apiVersion,
        targetNamespace: "urn:partner.soap.sforce.com"
      },
      Apex: {
        servicePortAddress: "/services/Soap/s/" + apiVersion,
        targetNamespace: "http://soap.sforce.com/2006/08/apex"
      },
      Metadata: {
        servicePortAddress: "/services/Soap/m/" + apiVersion,
        targetNamespace: "http://soap.sforce.com/2006/04/metadata"
      },
      Tooling: {
        servicePortAddress: "/services/Soap/T/" + apiVersion,
        targetNamespace: "urn:tooling.soap.sforce.com"
      }
    };
    if (apiName) {
      wsdl = wsdl[apiName];
    }
    return wsdl;
  }

  soap(wsdl, method, args, {headers} = {}) {
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
    let requestBody = xmlBuilder(
      "soapenv:Envelope",
      ' xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="' + wsdl.targetNamespace + '"',
      {
        "soapenv:Header": Object.assign({}, sessionHeader, headers),
        "soapenv:Body": {[method]: args}
      }
    );
    return this._request(httpsOptions, requestBody).then(({response, responseBody}) => {
      let resBody = xmlParser(responseBody)["soapenv:Envelope"]["soapenv:Body"];
      if (response.statusCode == 200) {
        return resBody[method + "Response"].result;
      } else {
        let err = new Error();
        err.name = "SalesforceSoapError";
        err.message = resBody["soapenv:Fault"].faultstring;
        err.detail = resBody["soapenv:Fault"];
        err.response = response;
        err.responseBody = responseBody;
        throw err;
      }
    });
  }

  _request(httpsOptions, requestBody) {
    return new Promise((resolve, reject) => {
      let req = https.request(httpsOptions, response => {
        let responseBody = "";
        response.on("data", chunk => responseBody += chunk);
        response.on("end", () => {
          resolve({response, responseBody});
        });
        response.on("error", reject);
      });
      req.on("error", ex => {
        let err = new Error();
        err.name = "SalesforceNetworkError";
        err.message = String(ex);
        err.detail = ex;
        err.request = req;
        reject(err);
      });
      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    });
  }

  asArray(x) {
    if (!x) return [];
    if (x instanceof Array) return x;
    return [x];
  }

}

module.exports = SalesforceConnection;
