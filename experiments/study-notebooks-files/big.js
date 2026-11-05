const fs=require('fs');const n=+process.argv[2];let h='<meta charset=utf8><body>';
for(let i=1;i<=n;i++)h+=`<section style="page-break-after:always;font:20px Arial;padding:40px"><h2>Lecture ${i}</h2><p>Topic number ${i}: the value of parameter K${i} is ${i*7}. ${'Filler sentence about algorithms and systems. '.repeat(20)}</p><p dir=rtl>עמוד ${i}: הערך של הפרמטר הוא ${i*7}.</p></section>`;
fs.writeFileSync(`big${n}.html`,h);
