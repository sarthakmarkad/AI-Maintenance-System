// Provider output and older replies sometimes put a numbered sequence on one line.
// Add layout only for an unambiguous sequence; existing stored replies stay unchanged.
function formatInlineSteps(text) {
  if (/[\n\r`]/.test(text)) return text;
  const markers = [...text.matchAll(/(?:^|[ \t]+)([1-9]\d?)[.)][ \t]+(?=\S)/g)];
  if (markers.length < 2 || markers.some((m, i) => Number(m[1]) !== i + 1))
    return text;
  let result = "",
    start = 0;
  for (const marker of markers) {
    result += text.slice(start, marker.index).trimEnd() + `\n\n${marker[1]}. `;
    start = marker.index + marker[0].length;
  }
  return (result + text.slice(start)).trim();
}

exports.formatInlineSteps = formatInlineSteps;
