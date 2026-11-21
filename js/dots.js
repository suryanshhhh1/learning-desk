// =============================================================
// Dot-matrix lettering, drawn as SVG dots (no font file needed).
//
// Usage in HTML:   <div class="dots dot-xl" data-dots="HI ANUSHKA."></div>
// Usage in JS:     DotText.render(element, "87%")
//
// The dot spacing comes from the CSS variable --dot on the element
// (see .dot-xl / .dot-lg / .dot-md in style.css). Text wraps by word
// to fit the element's width and redraws when the window is resized.
// Screen readers get the plain text through aria-label.
// =============================================================

window.DotText = (function () {
  // 5 x 7 glyphs. Each string is one row, "1" = dot.
  var G = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "10001", "01010", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ".": ["000", "000", "000", "000", "000", "110", "110"],
    ",": ["000", "000", "000", "000", "110", "010", "100"],
    ":": ["000", "110", "110", "000", "110", "110", "000"],
    "'": ["010", "010", "100", "000", "000", "000", "000"],
    "!": ["1", "1", "1", "1", "1", "0", "1"],
    "-": ["0000", "0000", "0000", "1111", "0000", "0000", "0000"],
    "/": ["00000", "00001", "00010", "00100", "01000", "10000", "00000"],
    "%": ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
    " ": ["000", "000", "000", "000", "000", "000", "000"]
  };
  var LINE_GAP = 3; // empty dot rows between wrapped lines

  function glyph(ch) { return G[ch] || G[" "]; }
  function charWidth(ch) { return glyph(ch)[0].length; }
  function lineWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += charWidth(s[i]) + (i ? 1 : 0);
    return w;
  }

  // Greedy word wrap so each line fits in maxCols dot columns.
  function wrap(text, maxCols) {
    var words = text.split(/\s+/).filter(Boolean);
    var lines = [];
    var line = "";
    words.forEach(function (word) {
      var candidate = line ? line + " " + word : word;
      if (lineWidth(candidate) <= maxCols || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function render(el, text) {
    if (!el) return;
    text = String(text == null ? "" : text).toUpperCase();
    el.dataset.dots = text;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", el.dataset.label || text);

    var pitch = parseFloat(getComputedStyle(el).getPropertyValue("--dot")) || 6;
    var width = el.clientWidth || (el.parentNode && el.parentNode.clientWidth) || 600;
    var maxCols = Math.max(12, Math.floor(width / pitch));
    var lines = wrap(text, maxCols);
    var cols = Math.max.apply(null, lines.map(lineWidth).concat([1]));
    var rows = lines.length * 7 + (lines.length - 1) * LINE_GAP;
    var center = el.dataset.align === "center";

    var dots = [];
    lines.forEach(function (line, li) {
      var x = center ? Math.floor((cols - lineWidth(line)) / 2) : 0;
      var y0 = li * (7 + LINE_GAP);
      for (var i = 0; i < line.length; i++) {
        var g = glyph(line[i]);
        for (var r = 0; r < 7; r++) {
          for (var c = 0; c < g[r].length; c++) {
            if (g[r][c] === "1") dots.push("M" + (x + c + 0.5) + " " + (y0 + r + 0.5) + "m-.38 0a.38 .38 0 1 0 .76 0a.38 .38 0 1 0-.76 0");
          }
        }
        x += g[0].length + 1;
      }
    });

    el.innerHTML =
      '<svg aria-hidden="true" focusable="false" viewBox="0 0 ' + cols + " " + rows + '" width="' + (cols * pitch) +
      '" height="' + (rows * pitch) + '"><path fill="currentColor" d="' + dots.join("") + '"/></svg>';
  }

  function renderAll() {
    document.querySelectorAll("[data-dots]").forEach(function (el) { render(el, el.dataset.dots); });
  }

  // Redraw on resize so the wrapping matches the new width.
  var t;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(renderAll, 120);
  });
  document.addEventListener("DOMContentLoaded", renderAll);

  return { render: render, renderAll: renderAll };
})();
