# node-salesforce-connection
[![Build Status](https://travis-ci.org/jesperkristensen/node-salesforce-connection.svg?branch=master)](https://travis-ci.org/jesperkristensen/node-salesforce-connection)

node-salesforce-connection is a minimal library for connecting to Salesforce from Node.js.
It provides an absolute minimal wrapper that allows you to call any Salesforce API.
It tries hard to not get in the way between you and Salesforce.
It has no dependencies.

1. [Introduction](#introduction)
1. [Logging in](#logging-in)
1. [REST](#rest)
1. [SOAP](#soap)
1. [Error handling](#error-handling)

This library works in Node.js.
There is an almost identical [library that works in browsers](https://github.com/sorenkrabbe/Chrome-Salesforce-inspector/blob/master/addon/inspector.js),
but that it not yet published as a stand-alone package.

## Introduction

This documentation explains how the node-salesforce-connection library works,
but you need to read this in combination with the [official Salesforce API documentation](https://developer.salesforce.com/docs/?select_type=Integration),
since this document does not explain how the Salesforce APIs themselves work.

Create your own project using `npm init` and then add this library as a dependency using `npm install node-salesforce-connection --save`.

Use it like this in your JS file:

```js
let SalesforceConnection = require("node-salesforce-connection");

(async () => {

  let sfConn = new SalesforceConnection();

  await sfConn.soapLogin({
    hostname: "login.salesforce.com",
    apiVersion: "39.0",
    username: "example@example.com",
    password: "MyPasswordMySecurityToken",
  });

  let recentAccounts = await sfConn.rest("/services/data/v39.0/query/?q="
    + encodeURIComponent("select Id, Name from Account where CreatedDate = LAST_WEEK"));

  for (let account of recentAccounts.records) {
    console.log("Account " + account.Name + " was created recently.");
  }

})().catch(ex => console.error(ex.stack));
```

The examples use the JavaScript `await` keyword.
This assumes the examples are placed in an [async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) like the one above.
You don't have to use async functions, if you prefer using the traditional [`promise.then(handler)` syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

## Logging in

The first thing you need to do is log in to Salesforce.

### Logging in using the SOAP API

You can use the `soapLogin` function to log in using a username and password:

```js
let sfConn = new SalesforceConnection();

await sfConn.soapLogin({
  hostname: "login.salesforce.com",
  apiVersion: "39.0",
  username: "example@example.com",
  password: "MyPasswordMySecurityToken",
});
```

The function calls the SOAP [login](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_login.htm) method.

The function returns a [promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
that behaves identically to the promise [returned from the `soap` function](#soap-return).
When the promise resolves successfully, `sfConn` will be ready to use.

### Logging in using OAuth

You can log in using OAuth. Here is an example of the [Username-Password OAuth Authentication Flow](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_username_password_oauth_flow.htm):

```js
let sfConn = new SalesforceConnection();
let tokenRequest = {
  grant_type: "password",
  client_id: "MyConsumerKey",
  client_secret: "MyConsumerSecret",
  username: "example@example.com",
  password: "MyPasswordMySecurityToken",
};
let hostname = "login.salesforce.com";
await sfConn.oauthToken(hostname, tokenRequest);
```

The function makes a `POST` request to `/services/oauth2/token`.

The function returns a [promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
that behaves identically to the promise [returned from the `rest` function](#rest-return).
When the promise resolves successfully, `sfConn` will be ready to use.

Use the `oauthToken` function with the
[Web Server](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_web_server_oauth_flow.htm),
[Username-Password](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_username_password_oauth_flow.htm) and
[Refresh Token](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_refresh_token_oauth.htm)
OAuth authentication flows. Use the manual approach described below for the [User-Agent](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_user_agent_oauth_flow.htm) flow.

### Logging in manually

If SOAP or OAuth login does not work for you, you can manually initialize the connection with your own questionably obtained session information:

```js
let sfConn = new SalesforceConnection();
sfConn.instanceHostname = "na1.salesforce.com";
sfConn.sessionId = ".....";
```

## REST

The best way to make API calls is using any Salesforce REST API.
Use for example the
[Bulk](https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/),
[Chatter](https://developer.salesforce.com/docs/atlas.en-us.chatterapi.meta/chatterapi/),
[REST](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/),
[Tooling](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/) or
[Reports and Dashboards](https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/) API.

Example using [query](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm):

```js
let recentAccounts = await sfConn.rest("/services/data/v39.0/query/?q="
  + encodeURIComponent("select Id, Name from Account where CreatedDate = LAST_WEEK"));

for (let account of recentAccounts.records) {
  console.log("Account " + account.Name + " was created recently.");
}
```

Example [creating a record](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_sobject_create.htm):

```js
let myNewAccount = {Name: "test"};

let result = await sfConn.rest("/services/data/v39.0/sobjects/Account",
  {method: "POST", body: myNewAccount});

console.log("Created Account with ID " + result.id
  + (result.success ? " successfully." : " failed."));
```

The `rest` function accepts the following parameters:
```js
sfConn.rest(path, {method, api, body, bodyType, headers, responseType});
```

<table>
  <tr>
    <th> Parameter
    <th> Type
    <th> Default
    <th> Description
  <tr>
    <td> <code>path</code>
    <td> string
    <td> (required)
    <td> A path relative URL to request. E.g. <code>/path/to/resource?param=value&other=two</code>.
  <tr>
    <td> <code>method</code>
    <td> string
    <td> <code>"GET"</code>
    <td> The HTTP method to use.
  <tr>
    <td> <code>api</code>
    <td> string
    <td> <code>"normal"</code>
    <td>
      The type of REST API.
      <dl>
        <dt> <code>"normal"</code>
        <dd> Pass the Session ID in the format expected by most Salesforce REST APIs.
        <dt> <code>"bulk"</code>
        <dd> Pass the Session ID in the format expected by the Bulk API.
      </dl>
  <tr>
    <td> <code>body</code>
    <td> Depends on <code>bodyType</code>
    <td> (none)
    <td> Used as the HTTP request body, formatted according to the <code>bodyType</code> parameter.
  <tr>
    <td> <code>bodyType</code>
    <td> string
    <td> <code>"json"</code>
    <td>
      Indicates the type of the <code>body</code> parameter.
      <dl>
        <dt> <code>"json"</code>
        <dd> The <code>body</code> parameter is interpreted as a JavaScript object that will be converted to JSON.
        <dt> <code>"urlencoded"</code>
        <dd> The <code>body</code> parameter is interpreted as a JavaScript object that will be converted into URL encoded form data.
        <dt> <code>"raw"</code>
        <dd>
          The <code>body</code> parameter is interpreted as a string or Node.js Buffer and used directly in the HTTP request.
          Remember to set the <code>Content-Type</code> header.
      </dl>
  <tr>
    <td> <code>headers</code>
    <td> object
    <td> (none)
    <td>
      A JavaScript object of additional <a href="https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/headers.htm">HTTP headers</a>.
      Example: <code>{"Sforce-Query-Options": "batchSize=1000"}</code>.
  <tr>
    <td> <code>responseType</code>
    <td> string
    <td> <code>"json"</code>
    <td>
      Indicates the type of the HTTP response body.
      <dl>
        <dt> <code>"json"</code>
        <dd> The HTTP response body will be parsed as JSON.
        <dt> <code>"raw"</code>
        <dd>
          The HTTP response body will not be parsed,
          and a <a href="#salesforce-response"><code>SalesforceResponse</code></a>
          object will be returned,
          containing the HTTP response headers, response status and binary response body.
          This allows you to read binary data or work around bugs in the Salesforce API.
          Remember to set the <code>Accept</code> header if applicable.
      </dl>
</table>

<a name="rest-return"></a>
The `rest` function returns a [promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

If the request succeeds, the promise will resolve with the HTTP response parsed according to the `responseType` parameter.

If the request fails because Salesforce returned an error response (such as HTTP 400), the promise will reject with an `Error` with these properties:

<table>
  <tr>
    <th> Property name
    <th> Type
    <th> Value
  <tr>
    <td> <code>name</code>
    <td> string
    <td> <code>"SalesforceRestError"</code>
  <tr>
    <td> <code>message</code>
    <td> string
    <td> A descriptive error message. A text version of the <code>detail</code> property, or the HTTP status message if we did not receive a HTTP response body.
  <tr>
    <td> <code>detail</code>
    <td> Depends on <code>responseType</code>
    <td> The HTTP response body parsed according to the <code>responseType</code> input parameter.
  <tr>
    <td> <code>response</code>
    <td> <a href="#salesforce-response"><code>SalesforceResponse</code></a>
    <td> An object containing the HTTP response headers, response status and binary response body.
</table>

If the request fails because Node.js could not connect to Salesforce, the promise will reject with a <a href="https://nodejs.org/api/errors.html#errors_system_errors">Node.js System Error</a>.

A <a name="salesforce-response"></a>`SalesforceResponse` object has these properties:

<table>
  <tr>
    <th> Property name
    <th> Type
    <th> Value
  <tr>
    <td> <code>headers</code>
    <td> object
    <td> The HTTP <a href="https://nodejs.org/dist/latest/docs/api/http.html#http_message_headers">response headers</a>.
  <tr>
    <td> <code>statusCode</code>
    <td> number
    <td> The 3-digit HTTP response status code. E.g. <code>404</code>.
  <tr>
    <td> <code>statusMessage</code>
    <td> string
    <td> The HTTP response status message (reason phrase). E.g. <code>OK</code> or <code>Internal Server Error</code>.
  <tr>
    <td> <code>body</code>
    <td> Node.js Buffer
    <td> The HTTP response body. Call <code>response.body.toString()</code> to get the response body as text.
</table>


## SOAP

If the functionality you are looking for is not available via any of the Salesforce REST APIs,
you might be able to find a Salesforce SOAP API that does what you need.
However, this being JavaScript, you should probably avoid SOAP when possible.

Example using [upsert](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_upsert.htm):
```js
let enterpriseWsdl = sfConn.wsdl("39.0", "Enterprise");

let contacts = [
  {$type: "Contact", FirstName: "John", LastName: "Smith", Email: "john.smith@example.com"},
  {$type: "Contact", FirstName: "Jane", LastName: "Smith", Email: "jane.smith@example.com"},
];

let upsertResults = await sfConn.soap(enterpriseWsdl, "upsert",
  {externalIdFieldName: "Email", sObjects: contacts});

for (let r of sfConn.asArray(upsertResults)) {
  console.log((r.created == "true" ? "Created" : "Updated")
    + " Contact with ID " + r.id + " "
    + (r.success == "true" ? "successfully" : "failed") + ".");
}
```

Before you make a SOAP API request, you need a WSDL, which you get using the `wsdl` function.
Well, you don't actually get the full WSDL file.
You only get the absolute minimum information needed to make SOAP API calls from JavaScript.

The `wsdl` function accepts the following parameters:
```js
sfConn.wsdl(apiVersion, apiName);
```

<table>
  <tr>
    <th> Parameter
    <th> Type
    <th> Default
    <th> Description
  <tr>
    <td> <code>apiVersion</code>
    <td> string
    <td> (required)
    <td> The Salesforce API version you want to use.
  <tr>
    <td> <code>apiName</code>
    <td> string
    <td> (required)
    <td>
      The Salesforce SOAP API you want to use. Supported values are
      <a href="https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/"><code>"Enterprise"</code></a>,
      <a href="https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/"><code>"Partner"</code></a>,
      <a href="https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_web_services_methods.htm"><code>"Apex"</code></a>,
      <a href="https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/"><code>"Metadata"</code></a> and
      <a href="https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/"><code>"Tooling"</code></a>.
</table>

The `wsdl` function returns an object containing information from the WSDL that is needed to make SOAP requests.

Alternatively, you can call the `wsdl` function with only one parameter to get an object with all the WSDL's we know:
```js
let wsdlSet = sfConn.wsdl(apiVersion);
let myWsdl = wsdlSet[apiName];
```

With the WSDL information at hand, you can make your SOAP API request using the `soap` function.

The `soap` function accepts the following parameters:
```js
sfConn.soap(wsdl, method, args, {headers});
```

<table>
  <tr>
    <th> Parameter
    <th> Type
    <th> Default
    <th> Description
  <tr>
    <td> <code>wsdl</code>
    <td> object
    <td> (required)
    <td>
      An object containing information from the WSDL that is needed to make SOAP requests.
      You can either obtain this object by calling <code>sfConn.wsdl</code> or create the object manually.
  <tr>
    <td> <code>method</code>
    <td> string
    <td> (required)
    <td>
      The SOAP method to be called, as found in the Salesforce documentation.
      The example above uses <a href="https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_upsert.htm">upsert</a>.
  <tr>
    <td> <code>args</code>
    <td> object
    <td> (required)
    <td>
      The arguments to the called SOAP method, as found in the Salesforce documentation.
      Pass an object where each property corresponds to a SOAP method argument by name.
      Pass an empty object if the method does not require any arguments.
  <tr>
    <td> <code>headers</code>
    <td> object
    <td> (none)
    <td>
      An optional object with <a href="https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/soap_headers.htm">Salesforce SOAP headers</a>.
      Pass an object where each property corresponds to a SOAP header by name.
      The Salesforce Session ID is automatically added here, so you don't have to.
      Example: <code>{AllOrNoneHeader: {allOrNone: false}, EmailHeader: {triggerAutoResponseEmail: true}}</code>.
</table>

sObjects are a bit special in the SOAP API. You always need to specify the type of an sObject.
In the Partner WSDL, use the `type` property (Example: `{type: "Account", Name: "Example"}`).
In the Enterprise WSDL and others, use the `$type` property (Example: `{$type: "Account", Name: "Example"}`).

<a name="soap-return"></a>
The `soap` function returns a [promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

If the request succeeds, the promise will resolve with the SOAP method's return value.

When you get the return value from a SOAP API call, you won't get the precise type of the returned data, since that information is only available in the WSDL. You have to convert the type yourself using these rules:
* If you expect a string, you will get a string.
* If you expect a number, you will get a string. Convert it to a number using for example `let myNumber = Number(myValue)`.
* If you expect a boolean, you will get a string. Convert it to a boolean using for example `let myBoolean = myValue == "true"`.
* If you expect null, you will get null.
* If you expect an object, you will get an object.
* If you expect an array, you will get different things if your array has zero, one or more elements. Convert it to an array using the `asArray` utility function, for example `let myArray = sfConn.asArray(mvValue);`.

If the request fails because Salesforce returned a [SOAP fault](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_concepts_core_data_objects.htm),
the promise will reject with an `Error` with these properties:

<table>
  <tr>
    <th> Property name
    <th> Type
    <th> Value
  <tr>
    <td> <code>name</code>
    <td> string
    <td> <code>"SalesforceSoapError"</code>
  <tr>
    <td> <code>message</code>
    <td> string
    <td> A descriptive error message. The <code>faultstring</code> part of the SOAP fault message returned by Salesforce.
  <tr>
    <td> <code>detail</code>
    <td> object
    <td> The <a href="https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_concepts_core_data_objects.htm">SOAP fault message</a> returned by Salesforce.
  <tr>
    <td> <code>response</code>
    <td> <a href="#salesforce-response"><code>SalesforceResponse</code></a>
    <td> An object containing the HTTP response headers, response status and binary response body.
</table>

If the request fails because Node.js could not connect to Salesforce, the promise will reject with a <a href="https://nodejs.org/api/errors.html#errors_system_errors">Node.js System Error</a>.

## Error handling

The `rest` and `soap` functions return <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise">promises</a> you can use in error handling like any other promise.

Example:

```js
try {
  let result = await sfConn.rest("/services/data/v39.0/query/?q="
    + encodeURIComponent("select Id from UnknownObject"));
  console.log(result);
} catch (ex) {
  if (ex.name == "SalesforceRestError") {
    console.log("Salesforce returned an error: " + ex.message);
  } else if (ex.syscall == "getaddrinfo") {
    console.log("Could not make request. Are you offline?");
  } else {
    throw ex; // Unknown type of error
  }
}
```

Same example with an older JavaScript syntax:
```js
sfConn.rest("/services/data/v39.0/query/?q="
  + encodeURIComponent("select Id from UnknownObject"))
.then(function(result) {
  console.log(result);
}, function(ex) {
  if (ex.name == "SalesforceRestError") {
    console.log("Salesforce returned an error: " + ex.message);
  } else if (ex.syscall == "getaddrinfo") {
    console.log("Could not make request. Are you offline?");
  } else {
    throw ex; // Unknown type of error
  }
});
```

## History

Before I made this library, I used JSForce.
It is a nice library, but I ran into a few bugs, and I needed a specific new Salesforce APIs that was not yet added to JSForce at the time.
So I made this library instead, which aims to give you access to any current or future Salesforce API without needing to update the library.
It aims to provide 95% of the convenience for 5% of the size/complexity.
