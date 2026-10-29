// Self-check for Tally XML text decoding (bug: tally_godown_list showed "&#4; Primary").
// Run with: node scripts/xml-decode.check.js
const assert = require("node:assert");
const { decodeXml, firstTag } = require("../src/agent/xml");
const { TallyClient } = require("../src/agent/tally-client");

// 1. Numeric character references are decoded, and Tally's invisible U+0004 root marker disappears.
assert.strictEqual(decodeXml("&#4; Primary"), "Primary");
assert.strictEqual(decodeXml("&#x4; Primary"), "Primary");
assert.strictEqual(decodeXml("A &#38; B"), "A & B");
assert.strictEqual(decodeXml("A &#x26; B"), "A & B");
assert.strictEqual(decodeXml("line1&#13;&#10;line2"), "line1\r\nline2");

// 2. Named entities still work.
assert.strictEqual(decodeXml("Tom &amp; Jerry &lt;b&gt; &quot;x&quot; &apos;y&apos;"), `Tom & Jerry <b> "x" 'y'`);

// 3. Single pass: an escaped entity is literal text, not decoded a second time.
assert.strictEqual(decodeXml("&amp;lt;"), "&lt;");
assert.strictEqual(decodeXml("&amp;#4; Primary"), "&#4; Primary");

// 4. Invalid references are left alone rather than throwing or inventing characters.
assert.strictEqual(decodeXml("&#xD800;"), "&#xD800;");
assert.strictEqual(decodeXml("&#9999999999;"), "&#9999999999;");
assert.strictEqual(decodeXml("&unknown;"), "&unknown;");

// 5. Control characters are dropped; tab, newline and CR survive; CDATA wrapper is removed.
assert.strictEqual(decodeXml("a\u0004b\u0000c\u007f"), "abc");
assert.strictEqual(decodeXml("a\tb\nc"), "a\tb\nc");
assert.strictEqual(decodeXml("<![CDATA[Plain text]]>"), "Plain text");

// 6. firstTag decodes through the same path.
assert.strictEqual(firstTag("<GODOWN><PARENT>&#4; Primary</PARENT></GODOWN>", "PARENT"), "Primary");

// 7. End to end through the parsers: a godown exported the way Tally writes it.
const client = new TallyClient(() => ({ tallyHost: "localhost", tallyPort: 9000 }));
const godowns = client.parseGodowns(`
<ENVELOPE><BODY><DATA><COLLECTION>
  <GODOWN NAME="Main Location">
    <NAME>Main Location</NAME>
    <PARENT>&#4; Primary</PARENT>
    <GUID>1a00df52-0000-0000-0000-0000000000aa</GUID>
  </GODOWN>
  <GODOWN NAME="Branch &amp; Co">
    <NAME>Branch &amp; Co</NAME>
    <PARENT>Main Location</PARENT>
    <GUID>1a00df52-0000-0000-0000-0000000000ab</GUID>
  </GODOWN>
</COLLECTION></DATA></BODY></ENVELOPE>`);
assert.strictEqual(godowns.length, 2);
assert.strictEqual(godowns[0].parent, "Primary");
assert.strictEqual(godowns[1].name, "Branch & Co");
assert.strictEqual(godowns[1].parent, "Main Location");

// 8. Ledger parsing keeps working (it used to carry its own &#NN; workaround) and no longer deletes real references.
const ledgers = client.parseLedgers(`
<ENVELOPE><BODY><DATA><COLLECTION>
  <LEDGER NAME="Acme &#38; Sons">
    <NAME>Acme &#38; Sons</NAME>
    <PARENT>Sundry Debtors</PARENT>
    <GUID>1a00df52-0000-0000-0000-0000000000ac</GUID>
  </LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>`);
assert.strictEqual(ledgers.length, 1);
assert.strictEqual(ledgers[0].parent, "Sundry Debtors");

console.log("Tally XML decode check passed.");
