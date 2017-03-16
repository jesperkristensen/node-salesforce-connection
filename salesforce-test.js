"use strict";
let SalesforceConnection = require("../node-salesforce-connection/salesforce");

class Test {

  static assertEquals(expected, actual, message) {
    let strExpected = JSON.stringify(expected);
    let strActual = JSON.stringify(actual);
    if (strExpected !== strActual) {
      process.exitCode = 1;
      let msg = new Error("assertEquals failed: Expected " + strExpected + " but found " + strActual);
      console.error(message);
      console.error(msg);
      throw msg;
    }
  }

  static assert(truth, msg) {
    if (!truth) {
      process.exitCode = 1;
      console.error("assert failed", msg);
      let err = new Error("assert failed: " + msg);
      throw err;
    }
  }

}

(async () => {

  let sfConn = new SalesforceConnection();

  {
    console.log("TEST: soapLogin");
    await sfConn.soapLogin({
      hostname: "login.salesforce.com",
      apiVersion: "39.0",
      username: process.env.TEST_USERNAME,
      password: process.env.TEST_PASSWORD,
    });
  }

  {
    console.log("TEST: wsdl and soap");
    let enterpriseWsdl = sfConn.wsdl("39.0", "Enterprise");

    let contacts = [
      {$type: "Contact", FirstName: "John", LastName: "Smith", Email: "john.smith@nodetest.example.com"},
      {$type: "Contact", FirstName: "Jane", LastName: "Smith", Email: "jane.smith@nodetest.example.com"},
    ];

    let res = await sfConn.soap(enterpriseWsdl, "upsert",
      {externalIdFieldName: "Email", sObjects: contacts});

    res = sfConn.asArray(res);
    Test.assertEquals(2, res.length);
    Test.assert(res[0].created == "true" || res[0].created == "false", res[0].created);
    Test.assert(res[0].id, res[0].id);
    Test.assertEquals("true", res[0].success);
    Test.assert(res[1].created == "true" || res[1].created == "false", res[1].created);
    Test.assert(res[1].id, res[1].id);
    Test.assertEquals("true", res[1].success);
  }

  {
    console.log("TEST: wsdl and soap, headers");
    let partnerWsdl = sfConn.wsdl("39.0").Partner;

    let contacts = [
      {type: "Contact", FirstName: "John", LastName: "Smith", Email: "john.smith@nodetest.example.com"},
      {type: "Contact", FirstName: "Jane", LastName: "Smith", Email: "jane.smith@nodetest.example.com"},
    ];
    let headers = {AllOrNoneHeader: {allOrNone: true}};

    let res = await sfConn.soap(partnerWsdl, "upsert",
      {externalIdFieldName: "Email", sObjects: contacts}, {headers});

    res = sfConn.asArray(res);
    Test.assertEquals(2, res.length);
    Test.assertEquals("false", res[0].created);
    Test.assert(res[0].id, res[0].id);
    Test.assertEquals("true", res[0].success);
    Test.assertEquals("false", res[1].created);
    Test.assert(res[1].id, res[1].id);
    Test.assertEquals("true", res[1].success);
  }

  let contacts;
  {
    console.log("TEST: rest, path + return value");
    contacts = await sfConn.rest("/services/data/v39.0/query/?q="
      + encodeURIComponent("select Id, Name from Contact where Email like '%nodetest.example.com' order by Name"));

    Test.assertEquals(2, contacts.records.length);
    Test.assertEquals("Jane Smith", contacts.records[0].Name);
    Test.assertEquals("John Smith", contacts.records[1].Name);
    Test.assertEquals(true, contacts.done);
  }

  {
    console.log("TEST: rest, method");
    for (let contact of contacts.records) {
      let res = await sfConn.rest(contact.attributes.url, {method: "DELETE"});
      Test.assertEquals(null, res);
    }
  }

  {
    console.log("TEST: rest, api");
    let body = {
      operation: "update",
      object: "Contact",
      concurrencyMode: "Parallel",
      contentType: "JSON",
    };
    let job = await sfConn.rest("/services/async/39.0/job", {method: "POST", body, api: "bulk"});
    Test.assertEquals(0, job.numberBatchesTotal);
    Test.assertEquals("Open", job.state);
  }

  {
    console.log("TEST: rest, body");
    let contact = {FirstName: "John", LastName: "Smith", Email: "john.smith@nodetest.example.com"};
    let result = await sfConn.rest("/services/data/v39.0/sobjects/Contact", {method: "POST", body: contact});
    Test.assert(result.id);
    Test.assertEquals(true, result.success);
    Test.assertEquals([], result.errors);
  }

  {
    console.log("TEST: rest, bodyType");
    let contact = '{"FirstName": "Jane", "LastName": "Smith", "Email": "jane.smith@nodetest.example.com"}';
    let result = await sfConn.rest("/services/data/v39.0/sobjects/Contact", {method: "POST", body: contact, bodyType: "raw", headers: {"Content-Type": "application/json"}});
    Test.assert(result.id);
    Test.assertEquals(true, result.success);
    Test.assertEquals([], result.errors);
  }

  {
    console.log("TEST: rest, responseType");
    let result = await sfConn.rest("/services/data/v39.0/limits/", {responseType: "raw", headers: {Accept: "application/json"}});
    Test.assertEquals(200, result.statusCode);
    Test.assertEquals("OK", result.statusMessage);
    result = JSON.parse(result.body.toString());
    Test.assertEquals("object", typeof result.DailyApiRequests);
  }

  {
    console.log("TEST: rest, headers");
    let contacts = await sfConn.rest("/services/data/v39.0/query/?q="
      + encodeURIComponent("select Id from Contact where Email like '%nodetest.example.com'"),
      {headers: {"Sforce-Query-Options": "batchSize=1000"}});

    Test.assertEquals(2, contacts.records.length);
  }

  {
    console.log("TEST: rest, error");
    try {
      await sfConn.rest("/services/data/v39.0/query/?q=invalid");
      throw new Error("expected an error");
    } catch (ex) {
      Test.assertEquals("SalesforceRestError", ex.name);
      Test.assertEquals("MALFORMED_QUERY: unexpected token: invalid", ex.message);
      Test.assertEquals([{message: "unexpected token: invalid", errorCode: "MALFORMED_QUERY"}], ex.detail);
      Test.assertEquals(400, ex.response.statusCode);
      Test.assertEquals("Bad Request", ex.response.statusMessage);
      Test.assertEquals('[{"message":"unexpected token: invalid","errorCode":"MALFORMED_QUERY"}]', ex.response.body.toString());
    }
  }

  {
    console.log("TEST: soap, error");
    let partnerWsdl = sfConn.wsdl("39.0", "Partner");

    let invalid = [
      {type: "Unknown", FirstName: "John", LastName: "Smith", Email: "john.smith@nodetest.example.com"},
    ];

    try {
      await sfConn.soap(partnerWsdl, "create",
        {sObjects: invalid});
      throw new Error("expected an error");
    } catch (ex) {
      Test.assertEquals("SalesforceSoapError", ex.name);
      Test.assertEquals("INVALID_TYPE: sObject type 'Unknown' is not supported. If you are attempting to use a custom object, be sure to append the '__c' after the entity name. Please reference your WSDL or the describe call for the appropriate names.", ex.message);
      Test.assertEquals("INVALID_TYPE: sObject type 'Unknown' is not supported. If you are attempting to use a custom object, be sure to append the '__c' after the entity name. Please reference your WSDL or the describe call for the appropriate names.", ex.detail.faultstring);
      Test.assertEquals(500, ex.response.statusCode);
      Test.assertEquals("Server Error", ex.response.statusMessage);
      Test.assert(ex.response.body.length > 0);
    }
  }

  {
    console.log("TEST: asArray");
    let o = {a: [1, 2], b: 3};
    Test.assertEquals([1, 2], sfConn.asArray(o.a));
    Test.assertEquals([3], sfConn.asArray(o.b));
    Test.assertEquals([], sfConn.asArray(o.c));
  }

  {
    console.log("TEST: network error");
    sfConn.instanceHostname = "invalid.salesforce.com";
    try {
      await sfConn.rest("/services/data/v39.0/query/?q=invalid");
      throw new Error("expected an error");
    } catch (ex) {
      Test.assertEquals("SalesforceNetworkError", ex.name);
      Test.assertEquals("Error: getaddrinfo ENOTFOUND invalid.salesforce.com invalid.salesforce.com:443", ex.message);
      Test.assertEquals({code: "ENOTFOUND", errno: "ENOTFOUND", syscall: "getaddrinfo", hostname: "invalid.salesforce.com", host: "invalid.salesforce.com", port: 443}, ex.detail);
    }
  }

  {
    console.log("TEST: soapLogin, error");
    try {
      await sfConn.soapLogin({
        hostname: "login.salesforce.com",
        apiVersion: "39.0",
        username: "test",
        password: "test",
      });
      throw new Error("expected an error");
    } catch (ex) {
      Test.assertEquals("SalesforceSoapError", ex.name);
    }
  }

  {
    console.log("TEST: oauthToken");
    let tokenRequest = {
      grant_type: "password",
      client_id: process.env.TEST_CONSUMER_KEY,
      client_secret: process.env.TEST_CONSUMER_SECRET,
      username: process.env.TEST_USERNAME,
      password: process.env.TEST_PASSWORD,
    };
    let hostname = "login.salesforce.com";
    let token = await sfConn.oauthToken(hostname, tokenRequest);
    Test.assertEquals("Bearer", token.token_type);
  }

  {
    console.log("TEST: using the oauthToken");
    let contacts = await sfConn.rest("/services/data/v39.0/query/?q="
      + encodeURIComponent("select Id, Name from Contact where Email like '%nodetest.example.com' order by Name"));

    Test.assertEquals(2, contacts.records.length);
  }

  {
    console.log("TEST: oauthToken, error");
    let tokenRequest = {
      grant_type: "password",
      client_id: "test",
      client_secret: "test",
      username: "test",
      password: "test",
    };
    try {
      await sfConn.oauthToken("login.salesforce.com", tokenRequest);
    } catch (ex) {
      Test.assertEquals("SalesforceRestError", ex.name);
      Test.assertEquals({error: "invalid_client_id", error_description: "client identifier invalid"}, ex.detail);
      Test.assertEquals(400, ex.response.statusCode);
      Test.assertEquals("Bad Request", ex.response.statusMessage);
    }
  }

  console.log("SUCCESS");

})().catch(e => {
  process.exitCode = 1;
  console.error(e.stack || e);
});
