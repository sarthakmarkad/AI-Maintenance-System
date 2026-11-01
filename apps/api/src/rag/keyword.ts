// Treat user text as words, never as full-text operators or SQL.
const questionWords = new Set(
  "a an the is are was were be been being do does did can could should would will may might must i we you they it its this that these those my our your their of for to from in on at by with as and or but not how what when where why which who please tell me about according explain show give says say manual manuals sop sops document documents reference references approved uploaded".split(
    " ",
  ),
);
export function keywordQuery(question: string) {
  const words =
    question
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [
    ...new Set(
      words.filter((word) => word.length > 1 && !questionWords.has(word)),
    ),
  ]
    .slice(0, 24)
    .map((word) => `"${word}"`)
    .join(" OR ");
}
