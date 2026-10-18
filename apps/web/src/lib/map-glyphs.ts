/** Native vector extension: feather fan and cork, not the court/navigation asset. */
export function shuttlecockGlyph() {
  const disk = document.createElement("span"); disk.className = "gb-venue-shuttle"; disk.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.6"); svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M9 16 3 7 7 3 12 2 17 3 21 7 15 16Z M7 3 11 16 M12 2v14 M17 3 13 16 M9 16h6v3a3 3 0 0 1-6 0Z M5 10l14 0");
  svg.append(path); disk.append(svg); return disk;
}
