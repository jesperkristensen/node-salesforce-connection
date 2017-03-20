"use strict";
let fs = require("fs");
let path = require("path");
let XML = require("./xml");

// Test the XML parser and serializer's ability to work on XML files from the Salesforce Metadata API.
// The test expects one command line parameter: The path to a directory with files extracted from a metadata ZIP file.

function walk(dir) {
  let list = fs.readdirSync(dir);
  for (let fileName of list) {
    let filePath = path.resolve(dir, fileName);
    let stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walk(filePath);
    } else {
      try {
        // Skip if the file has a non-xml extension or if there exists a file with the "-meta.xml" suffix
        filePath.endsWith(".js") || filePath.endsWith(".css") || fs.statSync(filePath + "-meta.xml");
        console.log("skipping " + filePath);
      } catch (ex) {
        console.log("parsing " + filePath);
        let data = fs.readFileSync(filePath);
        XML.parse(data.toString());
      }
    }
  }
}

global.salesforceXmlParseVerifier = (xml, parsed) => {
  // stringify the parsed xml, and verify the two are identical except:
  // * whitespace between tags in the input
  // * self-closing tags in the input
  // * comments in the input
  let out = XML.stringify(parsed);
  let xmlp = 0;
  let outp = 0;
  let spaceAllowed = true;
  while (xmlp < xml.length || outp < out.length) {
    if (xml[xmlp] === out[outp]) {
      xmlp++;
      outp++;
      if (xml[xmlp].trim() != "") {
        spaceAllowed = xml[xmlp] === ">";
      }
    } else if (spaceAllowed && xml[xmlp] && xml[xmlp].trim() == "") {
      xmlp++;
    } else if (xml.startsWith("/>", xmlp) && out.startsWith("></", outp)) {
      let p = out.indexOf(">", outp + "></".length);
      if (p < outp) {
        throw new Error("XML difference\nin:\n*" + xml.substr(xmlp, 50) + "*\nout:\n*" + out.substr(outp, 50) + "*\n" + spaceAllowed);
      }
      xmlp += "/>".length;
      outp = p + ">".length;
      spaceAllowed = true;
    } else if (xml.startsWith("<!--", xmlp - 1)) {
      let p = xml.indexOf("-->", xmlp - 1 + "<!--".length);
      if (p < xmlp) {
        throw new Error("XML difference\nin:\n*" + xml.substr(xmlp, 50) + "*\nout:\n*" + out.substr(outp, 50) + "*\n" + spaceAllowed);
      }
      xmlp = p + "-->".length;
      outp--;
    } else {
      throw new Error("XML difference\nin:\n*" + xml.substr(xmlp, 50) + "*\nout:\n*" + out.substr(outp, 50) + "*\n" + spaceAllowed);
    }
  }
};

let dir = process.argv[2];
if (!dir) {
  throw new Error("Specify a directory to scan");
}
walk(dir);
console.log("DONE");
