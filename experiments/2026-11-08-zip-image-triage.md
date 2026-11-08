# 2026-11-08: which images of a "saved as web page" Word zip are worth keeping?

Zip: Omri's lecture notes for Systems Programming, one big `.html` + 149 images in `images/`. I extracted it to a temp folder, looked at
**all 19 images of 20 KB and over** and **about 30 of the 130 smaller ones** (Read tool, by eye), and read the `<img>` tags of the html.
Nothing from the zip was copied into the repo; "where in the notes" is the position in the html as a percentage of its length, and the
figure names below are my own short words.

## What the html tells us (and does not)

- 177 `<img>` tags for 149 files. The tags have only `alt=""`, `src`, `title=""` and a `style` with the display `width`/`height` in px.
  There is **no `<figure>`, no caption, no alt text** (so "is it inside a figure / near a caption" cannot help for this export).
- No two files have the same bytes (sha1), but 18 files are referenced more than once. They are all tiny pieces (bullets, line pieces).
- Display size is almost exactly the pixel size (the export does not scale), so the html adds nothing the file header does not already say.
- The diagrams are **built from layers**: a frame, an oval, an arrow, a label are separate images, and a few "real" pictures are also
  stored whole. The many tiny files are mostly the layers.
- `<img>` is never inside a table cell here.

## Table: the 19 images of 20 KB and over (all RELEVANT)

| name | size | pixels | what it shows | where (%) | verdict |
|---|---|---|---|---|---|
| image120.png | 69.5 KB | 409x793 | Java class + a numbered stack-machine listing (how a call runs) | 15 | keep: the listing is NOT in the page text |
| image92.png | 51.9 KB | 373x792 | assembly-like listing of one procedure | 15 | keep: not in the text |
| image44.png | 52.9 KB | 485x711 | C++ examples (value, address, reference) | 17 | keep: not in the text |
| image55.png | 35.7 KB | 436x659 | C++ functions sum1..sum8 and a main | 18 | keep: not in the text |
| image119.png | 26.8 KB | 436x659 | C++ functions sum9..sum13 | 20 | keep: not in the text |
| image106.png | 25.8 KB | 294x660 | C++ class (Student) with getters | 21 | keep (partly in the text) |
| image54.png | 26.0 KB | 295x537 | same class, constructor version | 23 | keep (partly in the text) |
| image34.png | 32.5 KB | 295x664 | same class, with destructor | 25 | keep (partly in the text) |
| image114.png | 26.1 KB | 295x605 | same class, copy constructor | 26 | keep (partly in the text) |
| image61.png | 31.8 KB | 295x605 | same class, assignment operator | 28 | keep (partly in the text) |
| image31.png | 37.0 KB | 469x768 | C++ smart pointer class | 30 | keep, but the text already holds most of this code |
| image143.png | 260 KB | 469x486 | the dining philosophers picture (photos + plates) | 64 | keep: a real figure (large because it is a photo) |
| image146.jpg | 32.5 KB | 710x410 | a computer network with 4 networks | 66 | keep: a real figure |
| image104.png | 37.7 KB | 679x434 | selector / executor diagram with two channels | 75 | keep |
| image78.png | 23.1 KB | 679x323 | same diagram, a step of the animation | 78 | keep, near copy |
| image48.png | 27.2 KB | 679x323 | same diagram, another step | 78 | keep, near copy |
| image25.png | 26.4 KB | 679x323 | same diagram, another step | 79 | keep, near copy |
| image69.png | 26.8 KB | 679x323 | same diagram, another step | 79 | keep, near copy |
| image70.png | 26.4 KB | 679x323 | same diagram, another step | 79 | keep, near copy |

So **19 of 19 are worth keeping**. Four things I found: (1) the C++ screenshots of image119 / image55 / image44 / image120 / image92 are
the ONLY place their code appears (I searched the page text for their function names and lines: no match). (2) The Student-class
screenshots (106, 54, 34, 114, 61) and the smart pointer (31) are mostly also in the text (many matching lines), so they are the least
valuable, but the picture also shows which version goes with which slide, so I would still keep them. (3) The five selector/executor
pictures differ only by small details (a label in a box), so they are "near copies" no hash can find. (4) Formulas: this lecture has no
math screenshots; the "formula fragment" guess of the 20 KB rule fits other zips, not this one.

## The 20 KB rule was wrong for this zip

Of the 130 images under 20 KB, **19 are real figures** and the rest are pieces. Real ones I saw: a Java `Thread` listing (image82, 10 KB), two
Java `Runnable` listings (image76, 93: 14 to 18 KB), a thread/process diagram (image102, 101, 19: 18 KB), a web client/server figure
(image86, 77), a C++ snippet (image2, image65: 4 and 3 KB, small but real code), a "Students [Data]" / "[Definition]" layout (image18, 131),
the network figure parts (image4, 111, 74, 133). A 4 KB file can be a real code screenshot: **file size is the wrong test; pixels and
"how empty" are the right ones.**

## Table: sample of the smaller images (by eye) and what the NEW rule decides

| name | size | pixels | what it shows | bytes/pixel | old rule | new rule | verdict |
|---|---|---|---|---|---|---|---|
| image82.png | 10.4 KB | 638x183 | Java code (threads) | 0.089 | skip | keep | RELEVANT |
| image102.png | 17.9 KB | 559x305 | computer / RTE / two processes with threads | 0.105 | skip | keep | RELEVANT |
| image101.png, image19.png | 18 KB | 559x319 | same, three threads in one process | 0.103 | skip | keep | RELEVANT |
| image76.png, image93.png | 14-18 KB | 637x183 | Java code (Runnable) | 0.12-0.16 | skip | keep | RELEVANT |
| image86.png, image77.png | 14 KB | 517x136 | web client / server arrows | 0.2 | skip | keep | RELEVANT |
| image2.png | 4.7 KB | 293x129 | 4 lines of C++ | 0.125 | skip | keep | RELEVANT |
| image65.png | 3.5 KB | 293x132 | 1 line of C++ in braces | 0.089 | skip | keep | RELEVANT (tiny) |
| image18.png | 5.5 KB | 621x127 | four words in a row (labels of a diagram) | 0.069 | skip | keep | marginal |
| image131.png | 11.2 KB | 566x268 | words + arrows (a diagram of definitions) | 0.074 | skip | keep | RELEVANT |
| image4.png | 10.3 KB | 475x331 | process / RTE with arrows | 0.065 | skip | keep | RELEVANT |
| image133.png, image74.png | 17.5 KB | 621x247 | boxes and ovals (two copies, 72% in the notes) | 0.113 | skip | keep | RELEVANT |
| image23.png, image53.png | 1.8 KB | 248x147 | a box with one label ("Dirty/Clean Water") | 0.05 | skip | keep | expendable (label) |
| image115.png | 1.6 KB | 205x124 | a single diagonal line | 0.063 | skip | keep | expendable |
| image110.png | 2.6 KB | 562x469 | an empty frame with the word CPU | 0.010 | skip | skip | expendable |
| image75.png | 1.4 KB | 484x143 | a solid blue box with "RAM" | 0.020 | skip | skip | expendable (label) |
| image41.png, image22.png, image94.png, image16.png | 0.6-1 KB | 275-397 x 141-265 | blank frames | 0.010-0.015 | skip | skip | expendable |
| image88.png | 1.7 KB | 265x39 | a box with "Cache Memory" | 0.16 | skip | skip (too thin) | expendable (label) |
| image28.png, image117.png, image11.png, image144.png | 2-4 KB | 123-225 x 62-82 | ovals/boxes with one or two words (Water Purifier, Producer...) | 0.2-0.4 | skip | skip (small) | expendable (label) |
| image72.png, image49.png | under 1 KB | 50x54, 30x28 | an arrow, a bullet | 0.3-1 | skip | skip | expendable |
| image10, 73, 59, 96... (about 40 files) | 0.1 KB | 2 to 15 px thin | line pieces | 3-5 | skip | skip | expendable |

## Share that is relevant

- Of **149 images**: the 19 big ones + about 16 more of the small ones are real figures or code, so **about 35 of 149 (a quarter)** are
  worth a student's time. About **114 (three quarters)** are expendable: line pieces, bullets, blank frames, one-word label shapes.
- The old rule kept 19 (all relevant) and lost 16 relevant ones. The new rule keeps 38: the 35 relevant, plus 3 expendable ones
  (image23, image53, image115). It loses the one-word label shapes (Producer, Cache Memory, CPU, RAM, Water Purifier): they carry one word
  each and the page text already names these parts.

## The rule now in `unzip.js` (code only, no model)

`judgeImage` reads the PNG / JPEG / WebP header itself (`imageSize`, no package) and skips, only counting, a picture that is:
1. **thin or small**: shorter side under 60 px, or under 20,000 pixels in all;
2. **nearly empty**: under 0.03 compressed bytes per pixel (a blank frame; real code screenshots here are 0.065 and up, blank ones 0.010 to 0.020);
3. **the same bytes as a picture already kept** from this zip (sha1);
4. if the size cannot be read from the header: the old test, under 20 KB.

I did not use a "figure / caption / alt text" clue: this export has none, so I could not test it, and an untested clue would be guesswork.
Known limit: a diagram stored as many layers is only partly kept (the big whole pictures, not each label).
