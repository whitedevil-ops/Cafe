// Ordering for café table labels, which are free text and end up mixed:
// "T01".."T12" from the seed, then a bare "13" typed by the owner, plus named
// tables like "Patio".
//
// localeCompare with { numeric: true } is not enough on its own. It sorts
// "2" before "10" correctly, but digits sort before letters — so a table
// labelled "13" jumps ahead of "T01" and lands at the very top of the list.
//
// Comparing the numeric part FIRST, when both labels have one, gives the order
// an owner actually expects: T01 … T12, 13. Purely named tables fall through
// to a normal alphabetical comparison.
export function compareTableLabels(a: string, b: string): number {
  const na = a.match(/\d+/)
  const nb = b.match(/\d+/)
  if (na && nb) {
    const diff = Number(na[0]) - Number(nb[0])
    if (diff !== 0) return diff
  }
  // Numbered tables ahead of purely named ones ("Patio", "Terrace").
  if (na && !nb) return -1
  if (!na && nb) return 1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function byTableLabel<T extends { label: string }>(a: T, b: T): number {
  return compareTableLabels(a.label, b.label)
}
