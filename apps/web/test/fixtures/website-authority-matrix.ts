// ASTRA_MATRIX_BEGIN: pure fixture data also exercised by the offline helper probe.
export const websiteMatrixPositive: [string, string][] = [];
const sameWebsite = (inputs: string[], href?: string) => {
  for (const input of inputs) websiteMatrixPositive.push([input, href ?? input]);
};
sameWebsite([
  "HTTPS://EXAMPLE.ORG", " https://example.org/ ", "\u00a0https://example.org/\u00a0", "\ufeffhttps://example.org/\ufeff",
  "https:///example.org/", "https:////example.org/", "https://example.org:/", "https://example.org:443/", "https://example.org:000443/",
  "https://%65xample.org/", "https://example%2Eorg/", "https://example\uff0eorg/", "https://example\u3002org/", "https://example\uff61org/",
  "https://\uff45\uff58\uff41\uff4d\uff50\uff4c\uff45.org/", "https://ex\u00adample.org/", "https://ex\u200bample.org/",
  "https://ex\ufeffample.org/", "https://ex\u2060ample.org/", "https://ex\u034fample.org/",
], "https://example.org/");
sameWebsite(["http://example.org:80/", "http://example.org:00080/"], "http://example.org/");
websiteMatrixPositive.push(
  ["https://example.org:0/", "https://example.org:0/"], ["https://example.org:00000/", "https://example.org:0/"],
  ["https://example.org:65535/", "https://example.org:65535/"], ["https://example.org:00080/", "https://example.org:80/"],
  ["https://[::1]:000443/", "https://[::1]/"], ["https://[2001:0db8::1]/", "https://[2001:db8::1]/"],
  ["https://[::ffff:192.168.1.1]/", "https://[::ffff:c0a8:101]/"],
);
sameWebsite(
  ["https://2130706433/", "https://0177.0.0.1/", "https://0x7f.1/", "https://127.1/"],
  new URL("https://2130706433/").href,
);
// Node expectations; supported-browser parity, especially xn-- edge cases, remains UNVERIFIED.
sameWebsite([
  "https://./", "https://../", "https://example..org/", "https://example.org./", "https://-x.org/", "https://x_.org/",
  "https://localhost/", "https://10.0.0.1/", "https://[::1]/", "https://xn--/", "https://xn--a/", "https://xn--abc-/",
]);
sameWebsite([
  "https://\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444/", "https://xn--e1afmkfd.xn--p1ai/",
  "https://%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80.%D1%80%D1%84/",
], "https://xn--e1afmkfd.xn--p1ai/");
websiteMatrixPositive.push(
  ["https://e\u0301.org/", "https://xn--9ca.org/"], ["https://\u00e9.org/", "https://xn--9ca.org/"],
  ["https://\u0430pple.org/", "https://xn--pple-43d.org/"],
  ["https://example.org/\u043a\u043e\u043d\u0442\u0430\u043a\u0442\u044b", "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B"],
  ["https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B", "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B"],
  ["https://example.org/%d0%ba", "https://example.org/%d0%ba"], ["https://example.org/%D0%bA", "https://example.org/%D0%bA"],
  ["https://example.org/?q=\u043a\u043e\u043d\u0442\u0430\u043a\u0442\u044b#\ud83d\ude00", "https://example.org/?q=%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B#%F0%9F%98%80"],
  ["https://example.org/\ud83d\ude00", "https://example.org/%F0%9F%98%80"],
);
sameWebsite([
  "https://example.org/@user", "https://example.org/?@user", "https://example.org/#@user",
  "https://example.org/a?next=https://u:p@evil.test/#@x", "https://example.org//evil.test/@x", "https://example.org/%2F%40%3A",
  "https://example.org/%2F%2Fevil.test", "https://example.org/?next=https%3A%2F%2Fevil.test", "https://example.org/%25",
  "https://example.org/%250A", "https://example.org/%255C%2540%253A%2500", "https://example.org/%252F",
  "https://example.org/?a=1&b=2", "https://example.org/#a#b", "https://example.org/?q=?x",
]);
sameWebsite(["https://example.org/a/../b", "https://example.org/%2e%2e/b"], "https://example.org/b");
websiteMatrixPositive.push(
  ['https://example.org/"<>{}|^', "https://example.org/%22%3C%3E%7B%7D|%5E"],
  ["https://example.org/?q='x'", "https://example.org/?q=%27x%27"],
  ["https://example.org/a b", "https://example.org/a%20b"], ["https://example.org/a%20b", "https://example.org/a%20b"],
  ["https://example.org/a\u00a0b", "https://example.org/a%C2%A0b"], ["https://example.org/a%C2%A0b", "https://example.org/a%C2%A0b"],
  ["https://example.org/a\u2003b", "https://example.org/a%E2%80%83b"], ["https://example.org/a\u2028b", "https://example.org/a%E2%80%A8b"],
  ["https://example.org/a\u2029b", "https://example.org/a%E2%80%A9b"], ["https://example.org/\u202ex", "https://example.org/%E2%80%AEx"],
  ["https://example.org/\u2066x", "https://example.org/%E2%81%A6x"], ["https://example.org/\u200cb", "https://example.org/%E2%80%8Cb"],
  ["https://example.org/\u200db", "https://example.org/%E2%80%8Db"], ["https://example.org/\ufeffb", "https://example.org/%EF%BB%BFb"],
  ["https://example.org/a ", "https://example.org/a"],
);
for (const [value, href] of [["a".repeat(280), "a".repeat(280)], ["\u044f".repeat(46), "%D1%8F".repeat(46)]]) {
  websiteMatrixPositive.push(["https://example.org/" + value, "https://example.org/" + href]);
}
export const websiteMatrixNegative: unknown[] = [
  "https:///@example.org/", "https:///:@example.org/", "https:////@example.org/", "https:////:@example.org/",
  "https://@example.org/", "https://:@example.org/", "https://user@example.org/", "https://user:pass@example.org/",
  "https://:p@example.org/", "https://u:@example.org/", "https://@@example.org/", "https://a@b@example.org/", "https:///@:@example.org/",
  "https://%75ser:%70ass@example.org", "https://%40example.org/", "https:///%40example.org/",
  "https://", "https://?x", "https://#x", "https://:80/", "https://example.org:80:90/", "https://example.org:65536/",
  "https://example.org:x/", "https://example.org:+80/", "https://example.org:%38%30/", "https://256.1/", "https://09/",
  "https://[fe80::1%25eth0]/", "https://[::1/", "https://::1/", "https://[::1]x/",
  "//example.org", "/relative", "https:example.org", "https:/example.org", "http:\\host", "https:/\\example.org/",
  "https:\\\\example.org/", "https://example.org\\@evil.test", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "javascript%3Aalert(1)",
  "data:text/html,x", "DaTa:text/html,x", "vbscript:x", "blob:https://example.org/id", "file:///x", "ws://example.org/", "ftp://example.org/",
  "\thttps://example.org/", "https://example.org/\n", "ht\ttps://example.org/", "https:\n//example.org/", "https://exa\tmple.org/",
  "\u0000https://example.org/", "\u001fhttps://example.org/", "https://example.org/\u0000x",
  "https://example%2Forg/", "https://example%5Corg/", "https://example%40org/", "https://example%3A80/", "https://example%00org/", "https://%2565xample.org/",
  "https://ex\u200cample.org/", "https://ex\u200dample.org/", "https://ex\u202eample.org/", "https://ex\u2066ample.org/",
  "https://ex\u2028ample.org/", "https://ex\u2029ample.org/", "https://exa\u00a0mple.org/", "https://example\uff20evil.org/",
  "https://example\uff0fevil.org/", "https://example\uff1a80/",
  "https://example.org/\ud800", "https://example.org/\udc00", "https://example.org/?q=\ud800", "https://example.org/#\udc00",
  "https://example.org/" + "a".repeat(281), "https://example.org/" + "\u044f".repeat(47), " ".repeat(281) + "https://example.org/",
  "", " ", 42, false, {}, [], null, undefined, new String("https://example.org/"), () => "https://example.org/", 1n,
];
const websiteScalarTemplates = [
  (token: string) => "https://example.org/a" + token + "b",
  (token: string) => "https://example.org/?q=a" + token + "b",
  (token: string) => "https://example.org/#a" + token + "b",
  (token: string) => "https://a" + token + "b.org/",
  (token: string) => "https:///" + token + "@example.org/",
];
const forbiddenTemplates = [...websiteScalarTemplates,
  (token: string) => token + "https://example.org/", (token: string) => "https://example.org/" + token];
for (const cp of [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => 127 + i), 92]) {
  const c = String.fromCodePoint(cp);
  for (const token of [c, encodeURIComponent(c)]) {
    for (const template of forbiddenTemplates) websiteMatrixNegative.push(template(token));
  }
}
for (const token of ["%", "%A", "%ZZ", "%C0%AF", "%FF", "%80", "%AF", "%C2", "%E2%82", "%ED%A0%80", "%F4%90%80%80"]) {
  for (const template of [(t: string) => "https://example.org/" + t, (t: string) => "https://example.org/?q=" + t,
    (t: string) => "https://example.org/#" + t, (t: string) => "https://a" + t + "b.org/"]) websiteMatrixNegative.push(template(token));
}
// ASTRA_MATRIX_END
