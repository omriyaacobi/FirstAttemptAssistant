const fs=require('fs');
const pages=[
`<h1>Algorithm Design – Lecture 4</h1><p>Shortest paths and dynamic programming. Lecturer: Dr. Example.</p><p>Topics: Dijkstra, Bellman-Ford, knapsack.</p>`,
`<h2 dir="rtl">אלגוריתם דייקסטרה</h2><p dir="rtl">האלגוריתם של דייקסטרה מוצא מסלולים קצרים ביותר מצומת מקור בגרף עם משקלים אי-שליליים. סיבוכיות הזמן עם ערימת מינימום בינארית היא O((V+E) log V). האלגוריתם נכשל כאשר יש קשתות עם משקל שלילי.</p>`,
`<h2>Calculus 2 – Integration by parts</h2><p>∫ x·eˣ dx = x·eˣ − eˣ + C</p><p>Series: Σ<sub>n=1</sub><sup>∞</sup> 1/n² = π²/6 converges; Σ 1/n diverges (harmonic series).</p><p>Limit: lim<sub>x→0</sub> sin(x)/x = 1</p>`,
`<h2>Systems Programming – C</h2><pre>int *make(void){\n  int a[4] = {1,2,3,4};\n  return a;   // BUG: returns pointer to a local array\n}\nvoid f(void){ char *s = malloc(8); strcpy(s,"too long string"); }</pre><p>The first function returns a dangling pointer; the second overflows the heap buffer.</p>`,
`<h2>Knapsack table</h2><table border=1 cellpadding=6><tr><th>item</th><th>weight</th><th>value</th></tr><tr><td>A</td><td>2</td><td>3</td></tr><tr><td>B</td><td>3</td><td>4</td></tr><tr><td>C</td><td>4</td><td>5</td></tr></table><p>Capacity W = 5. Optimal value = 7 (items A and B).</p>`,
`<h2>Exam 2025 Moed A – Question 3 (25 points)</h2><p>Given a directed graph G with edge weights that may be negative, but no negative cycles, design an algorithm that finds the shortest path from s to every vertex in O(VE). Prove correctness.</p>`
];
const html=(p,i)=>`<section style="page-break-after:always;font:20px Arial;padding:40px">${p}<div style="position:absolute;bottom:20px">page ${i+1}</div></section>`;
fs.writeFileSync('text.html',`<meta charset=utf8><body>${pages.map(html).join('')}`);
// scan-like: one page, rotated, blurry, grayscale image
fs.writeFileSync('scan.html',`<meta charset=utf8><body style="margin:0;background:#ddd"><div style="width:700px;height:500px;background:#f4f1e8;padding:30px;transform:rotate(-1.5deg);filter:blur(0.7px) grayscale(1) contrast(.9);font:italic 26px 'Segoe Print','Comic Sans MS',cursive">${pages[1].replace('dir="rtl"','dir="rtl"')}<p>${pages[2].replace(/<\/?h2>/g,'')}</p></div>`);
