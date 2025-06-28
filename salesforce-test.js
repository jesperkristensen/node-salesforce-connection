"use strict";
let wrappedAssert = require("assert");
let SalesforceConnection = require("./salesforce");
let XML = require("./xml");

let assert = {};
for (let [name, value] of Object.entries(wrappedAssert)) {
  assert[name] = (...args) => {
    try {
      return value.apply(wrappedAssert, args);
    } catch (ex) {
      process.exitCode = 1;
      throw ex;
    }
  };
}

(async () => {

  global.salesforceXmlParseVerifier = (xml, parsed) => {
    let out = XML.stringify(parsed);
    assert.strictEqual(xml, out);
  };

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
    assert.strictEqual(res.length, 2);
    assert.ok(res[0].created == "true" || res[0].created == "false", res[0].created);
    assert.ok(res[0].id, res[0].id);
    assert.strictEqual(res[0].success, "true");
    assert.ok(res[1].created == "true" || res[1].created == "false", res[1].created);
    assert.ok(res[1].id, res[1].id);
    assert.strictEqual(res[1].success, "true");
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
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].created, "false");
    assert.ok(res[0].id, res[0].id);
    assert.strictEqual(res[0].success, "true");
    assert.strictEqual(res[1].created, "false");
    assert.ok(res[1].id, res[1].id);
    assert.strictEqual(res[1].success, "true");
  }

  let contacts;
  {
    console.log("TEST: rest, path + return value");
    contacts = await sfConn.rest("/services/data/v39.0/query/?q="
      + encodeURIComponent("select Id, Name from Contact where Email like '%nodetest.example.com' order by Name"));

    assert.strictEqual(contacts.records.length, 2);
    assert.strictEqual(contacts.records[0].Name, "Jane Smith");
    assert.strictEqual(contacts.records[1].Name, "John Smith");
    assert.strictEqual(contacts.done, true);
  }

  {
    console.log("TEST: rest, method");
    for (let contact of contacts.records) {
      let res = await sfConn.rest(contact.attributes.url, {method: "DELETE"});
      assert.strictEqual(res, null);
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
    assert.strictEqual(job.numberBatchesTotal, 0);
    assert.strictEqual(job.state, "Open");
  }

  {
    console.log("TEST: rest, body");
    let contact = {FirstName: "John", LastName: "Smith", Email: "john.smith@nodetest.example.com"};
    let result = await sfConn.rest("/services/data/v39.0/sobjects/Contact", {method: "POST", body: contact});
    assert.ok(result.id);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.errors, []);
  }

  {
    console.log("TEST: rest, bodyType");
    let contact = '{"FirstName": "Jane", "LastName": "Smith", "Email": "jane.smith@nodetest.example.com"}';
    let result = await sfConn.rest("/services/data/v39.0/sobjects/Contact", {method: "POST", body: contact, bodyType: "raw", headers: {"Content-Type": "application/json"}});
    assert.ok(result.id);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.errors, []);
  }

  {
    console.log("TEST: rest, responseType");
    let result = await sfConn.rest("/services/data/v39.0/limits/", {responseType: "raw", headers: {Accept: "application/json"}});
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.statusMessage, "OK");
    result = JSON.parse(result.body.toString());
    assert.strictEqual(typeof result.DailyApiRequests, "object");
  }

  {
    console.log("TEST: rest, headers");
    let contacts = await sfConn.rest("/services/data/v39.0/query/?q=" + encodeURIComponent("select Id from Contact where Email like '%nodetest.example.com'"),
      {headers: {"Sforce-Query-Options": "batchSize=1000"}});

    assert.strictEqual(contacts.records.length, 2);
  }

  {
    console.log("TEST: rest, error");
    try {
      await sfConn.rest("/services/data/v39.0/query/?q=invalid");
      throw new Error("expected an error");
    } catch (ex) {
      assert.strictEqual(ex.name, "SalesforceRestError");
      assert.strictEqual(ex.message, "MALFORMED_QUERY: unexpected token: 'invalid'");
      assert.deepStrictEqual(ex.detail, [{message: "unexpected token: 'invalid'", errorCode: "MALFORMED_QUERY"}]);
      assert.strictEqual(ex.response.statusCode, 400);
      assert.strictEqual(ex.response.statusMessage, "Bad Request");
      assert.strictEqual(ex.response.body.toString(), '[{"message":"unexpected token: \'invalid\'","errorCode":"MALFORMED_QUERY"}]');
    }
  }

  {
    console.log("TEST: rest, error with fields");
    try {
      let contact = {FirstName: "John", LastName: "Smith", Email: "not an email"};
      await sfConn.rest("/services/data/v39.0/sobjects/Contact", {method: "POST", body: contact});
      throw new Error("expected an error");
    } catch (ex) {
      assert.strictEqual(ex.name, "SalesforceRestError");
      assert.strictEqual(ex.message, "INVALID_EMAIL_ADDRESS: Email: invalid email address: not an email [Email]");
      assert.deepStrictEqual(ex.detail, [{message: "Email: invalid email address: not an email", errorCode: "INVALID_EMAIL_ADDRESS", fields: ["Email"]}]);
      assert.strictEqual(ex.response.statusCode, 400);
      assert.strictEqual(ex.response.statusMessage, "Bad Request");
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
      assert.strictEqual(ex.name, "SalesforceSoapError");
      assert.strictEqual(ex.message, "INVALID_TYPE: sObject type 'Unknown' is not supported. If you are attempting to use a custom object, be sure to append the '__c' after the entity name. Please reference your WSDL or the describe call for the appropriate names.");
      assert.strictEqual(ex.detail.faultstring, "INVALID_TYPE: sObject type 'Unknown' is not supported. If you are attempting to use a custom object, be sure to append the '__c' after the entity name. Please reference your WSDL or the describe call for the appropriate names.");
      assert.strictEqual(ex.response.statusCode, 500);
      assert.strictEqual(ex.response.statusMessage, "Server Error");
      assert.ok(ex.response.body.length > 0);
    }
  }

  {
    console.log("TEST: asArray");
    let o = {a: [1, 2], b: 3};
    assert.deepStrictEqual(sfConn.asArray(o.a), [1, 2]);
    assert.deepStrictEqual(sfConn.asArray(o.b), [3]);
    assert.deepStrictEqual(sfConn.asArray(o.c), []);
  }

  {
    console.log("TEST: network error");
    sfConn.instanceHostname = "invalid.salesforce.com";
    try {
      await sfConn.rest("/services/data/v39.0/query/?q=invalid");
      throw new Error("expected an error");
    } catch (ex) {
      assert.strictEqual(ex.name, "Error");
      assert.strictEqual(ex.message, "getaddrinfo ENOTFOUND invalid.salesforce.com");
      // TODO: assert.deepStrictEqual(ex, Object.assign(new Error("getaddrinfo ENOTFOUND invalid.salesforce.com"), {code: "ENOTFOUND", errno: -3008, syscall: "getaddrinfo", hostname: "invalid.salesforce.com"}));
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
      assert.strictEqual(ex.name, "SalesforceSoapError");
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
    assert.strictEqual(token.token_type, "Bearer");
  }

  {
    console.log("TEST: using the oauthToken");
    let contacts = await sfConn.rest("/services/data/v39.0/query/?q="
      + encodeURIComponent("select Id, Name from Contact where Email like '%nodetest.example.com' order by Name"));

    assert.strictEqual(contacts.records.length, 2);
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
      assert.strictEqual(ex.name, "SalesforceRestError");
      assert.deepStrictEqual(ex.detail, {error: "invalid_client_id", error_description: "client identifier invalid"});
      assert.strictEqual(ex.response.statusCode, 400);
      assert.strictEqual(ex.response.statusMessage, "Bad Request");
    }
  }

  console.log("SUCCESS");

})().catch(e => {
  process.exitCode = 1;
  console.error(e.stack || e);
});
