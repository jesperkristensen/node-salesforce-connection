"use strict";
/**
 * A very simple XML parser designed to parse the subset of XML that Salesforce produces.
 * It can read Salesforce SOAP responses and Metadata XML files.
 * It does not support many XML features such as namespaces, attributes, doctypes and cdata.
 * It might not always detect syntax errors in the XML.
 * It supports the XSI attributes.
 *
 * Returns a plain JavaScript object representation of the XML document, as an object with these properties:
 * - name : string : The root element's tag name.
 * - attributes : string : An unparsed list of the root element's attributes.
 * - value : any : A JavaScript value representing the contents of the root element.
 *
 * The content of an XML element is either of:
 * - null (if the element has the xsi:nil="true" attribute)
 *      We assume it has no child nodes.
 * - an object (if the element has child elements or if it has the xsi:type="..." attribute)
 *      Usually corresponds to a XSD Complex Type.
 *      We add each child element as a property on the object, with the tag name as the property name, and the content of the child element as the property value.
 *      If there are multiple child elements with the same name, we turn the property into an array of those childs.
 *      If the caller expects an array, but the array might not always have multiple entries, the caller can ensure the value is an array like this:
 *      let myArray = asArray(mvValue);
 *      We add the xsi:type attribute as a property named "$type" on the object, and we ignore all other attributes.
 *      If the element has no child elements, and if the element's text content is not only whitespace, we add the text content as a property named "$text".
 *      The only situation the $text property should be relevant, is if an element has an xsi:type attribute with a value that represents a XSD Simple Type.
 * - a string (otherwise)
 *      Usually corresponds to a XSD Simple Type.
 *      The string contains the text content of the element.
 *      The caller can then convert it to the relevant type, for example:
 *      let myNumber = Number(myValue);
 *      let myBoolean = myValue == "true";
 *
 */
function parse(xml) {
  let parser = new XMLParser();
  parser.xml = xml;
  parser.pos = 0;
  // Process XML Declaration, if there is any
  {
    let procEnd = parser.xml.indexOf("?>");
    if (procEnd >= 0) {
      parser.pos = procEnd + "?>".length;
    }
  }
  // Process whitespace, if there is any
  {
    let nextStart = parser.xml.indexOf("<", parser.pos);
    parser.assert(nextStart >= parser.pos);
    parser.pos = nextStart;
  }
  let parsed = parser.parseTag();
  if (global.salesforceXmlParseVerifier) {
    global.salesforceXmlParseVerifier(xml, parsed);
  }
  return parsed;
}

/**
 * XML Parser helper class.
 *
 * We have two properties:
 * this.xml : string : The XML data to be parsed.
 * this.pos : integer : The current parsing position in this.xml.
 */
class XMLParser {

  // Precond: this.xml[this.pos] is the "<" character in an start tag
  // Postcond: this.xml[this.pos] is the character after the ">" character in the corresponding end tag
  // Returns: Same as the parse function defined above.
  parseTag() {
    let name;
    let attributes;
    let value = ""; // A string or an object, default is string
    {
      // Consume the start tag
      this.assert(this.xml[this.pos] == "<");
      this.pos++;
      let startEnd = this.xml.indexOf(">", this.pos);
      this.assert(startEnd >= this.pos);
      let startTag = this.xml.substring(this.pos, startEnd);
      this.pos = startEnd + ">".length;

      let selfClosing = false;
      if (startTag.endsWith("/")) {
        selfClosing = true;
        startTag = startTag.substring(0, startTag.length - "/".length);
      }

      // Process the start tag
      let nameEnd = startTag.indexOf(" ");
      if (nameEnd >= 0) {
        // We have attributes
        name = startTag.substring(0, nameEnd);
        attributes = startTag.substring(nameEnd);

        // Parse the xsi:nil attribute
        if (attributes.includes(" xsi:nil=\"true\"")) {
          attributes = attributes.replace(" xsi:nil=\"true\"", "");
          if (!selfClosing) {
            // Assuming no child elements, find and process the end tag
            let endStart = this.xml.indexOf("<", this.pos);
            this.assert(endStart >= this.pos);
            this.pos = endStart;
            this.parseEndTag(name);
          }
          return {name, attributes, value: null};
        }

        // Parse the xsi:type attribute
        let typeStart = attributes.indexOf(" xsi:type=\"");
        if (typeStart >= 0) {
          let typeValueStart = typeStart + " xsi:type=\"".length;
          let typeValueEnd = attributes.indexOf("\"", typeValueStart);
          // Convert from string to object
          value = {$type: decode(attributes.substring(typeValueStart, typeValueEnd))};
          let typeEnd = typeValueEnd + "\"".length;
          attributes = attributes.substring(0, typeStart) + attributes.substring(typeEnd);
        }

      } else {
        // We don't have any attributes
        name = startTag;
        attributes = "";
      }

      if (selfClosing) {
        return {name, attributes, value};
      }

    }

    // Process text content, if there is any
    {
      let nextStart = this.xml.indexOf("<", this.pos);
      this.assert(nextStart >= this.pos);
      let text = this.xml.substring(this.pos, nextStart);
      text = decode(text);
      if (typeof value == "string") {
        value = text;
      } else if (text.trim() != "") {
        value.$text = text;
      }
      this.pos = nextStart;
    }

    // Consume and process child nodes + end tag
    for (;;) {

      // Process next tag
      if (this.xml.startsWith("</", this.pos)) {
        // The tag is an end tag
        this.parseEndTag(name);
        return {name, attributes, value};
      } else if (this.xml.startsWith("<!--", this.pos)) {
        // The tag is a comment
        this.pos += "<!--".length;
        let end = this.xml.indexOf("-->", this.pos);
        this.assert(end >= this.pos);
        this.pos = end + "-->".length;
      } else {
        // The tag is a start tag for a child element
        if (typeof value == "string") {
          // Convert from string to object, if not already done
          value = {};
        }
        let sub = this.parseTag();
        this.assertEq(sub.attributes, "");
        if (sub.name in value) {
          if (Array.isArray(value[sub.name])) {
            // Third or subsequent child with that name
            value[sub.name].push(sub.value);
          } else {
            // Second child with that name
            value[sub.name] = [value[sub.name], sub.value];
          }
        } else {
          // First child with that name
          value[sub.name] = sub.value;
        }
      }

      // Process whitespace, if there is any
      {
        let nextStart = this.xml.indexOf("<", this.pos);
        this.assert(nextStart >= this.pos);
        this.assertEq(this.xml.substring(this.pos, nextStart).trim(), "");
        this.pos = nextStart;
      }

    }
  }

  parseEndTag(name) {
    let endEnd = this.xml.indexOf(">", this.pos) + 1;
    this.assert(endEnd > this.pos);
    this.assertEq(this.xml.substring(this.pos, endEnd), "</" + name + ">");
    this.pos = endEnd;
  }

  assertEq(a, b) {
    this.assert(a == b, a + "==" + b);
  }

  assert(cond, note) {
    if (!cond) {
      // The error message is just for easier debugging. We don't actually support catching malformed XML.
      throw new Error("XML parser assertion failed\nPos:" + this.pos + "\nXML:" + this.xml.substr(this.pos, 30) + "\nNote:" + note);
    }
  }

}

function asArray(x) {
  if (!x) return [];
  if (x instanceof Array) return x;
  return [x];
}

function decode(text) {
  return text.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * Build an XML document to be consumed by Salesforce.
 * We can create Salesforce SOAP requests and Metadata XML files.
 * @param name : string : The tag name of the root element.
 * @param attributes : string : An XML string with attributes for the root element, such as namespace declarations.
 * @param value : any : A JavaScript object representing the contents of the XML.
 * @return string : The generated XML.
 *
 * A value is placed into an XML element like this:
 * - A null value puts the xsi:nil="true" attribute on the XML element.
 * - An object generates a child XML element for each property, with the property name used as the tag name and the child elements contents is generated from the property value.
 *      If a property value is an array, multiple child XML elements are created with the same tag name.
 *      The "$type" property is special because it does not create a child element, but instead puts an xsi:type attribute on the element.
 * - Any other type is used as the text contents of the element.
 */
function stringify({name, attributes, value}) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + Array.from(xmlTagBuilder(name, attributes, value)).join("");
}

function* xmlTagBuilder(name, attributes, value) {
  if (Array.isArray(value)) {
    for (let val of value) {
      yield* xmlTagBuilder(name, attributes, val);
    }
    return;
  }

  if (value === null) {
    yield "<" + name + attributes + " xsi:nil=\"true\"/>";
    return;
  } else if (typeof value === "object" && "$type" in value) {
    attributes += " xsi:type=\"" + encode(value.$type) + "\"";
  }

  yield "<" + name + attributes + ">";

  if (value === null) {
    // nothing
  } else if (typeof value == "object") {
    for (let [key, val] of Object.entries(value)) {
      if (key == "$type") {
        // skip
      } else if (key == "$text") {
        yield encode(val);
      } else {
        yield* xmlTagBuilder(key, "", val);
      }
    }
  } else {
    yield encode(value);
  }

  yield "</" + name + ">";
}

function encode(text) {
  return String(text).replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

module.exports = {parse, asArray, stringify, decode, encode};
