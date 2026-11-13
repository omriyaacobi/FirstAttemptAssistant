# Zip folders kept as labels (2026-11-13)

## The problem
An assignment zip had `mission1/ ... mission7/`, each with `README.md` and `README.pdf`. `unzip.js` handed back only the last
part of each name, so the course got 7 files all called `README.pdf`, and "open the mission 2 readme" failed. A stopgap
(same-named files show their id and first line) was already in main and still works.

## Research: does keeping the folder break a rule?
- **Zip names are never paths (ZIP UPLOAD).** Kept. The folder is a text field in the file's record (`course.json`), next to its
  name. Files are still stored as `files/<random id>.<ext>` (`courses.js`); nothing joins the folder into a path.
- **Bad entries.** `badName` in `unzip.js` already skips `..`, absolute paths, drive letters, backslashes, control characters and
  hidden parts BEFORE a file is kept. So the folder of a kept file is already clean. `cleanFolder` (`upload.js`) cleans it again
  anyway (control characters, `<>`, `.`/`..` parts, each part at most 60 characters, at most 200 in all, innermost kept), and
  `courses.addFile` runs it once more on save.
- **Untrusted text.** The folder is file data, like the name: shown to the model inside the tool output, never instructions.
  Matching what the model asks for (`pickFiles` in `brain.js`) is code: id, whole `folder/name`, the end of it, the plain name,
  then the old loose match. Several hits = Bot asks which (the stopgap's id + first line still shows).
- **Duplicates.** Same bytes in one course are still refused. New: when the old copy has NO folder and the upload brings one, the
  old copy gets the label (nothing else changes, no second copy). The duplicate check now runs before the "course is full" check,
  so labelling works in a full course too.
- **No big rewrite:** about 60 lines across `upload.js`, `unzip.js`, `courses.js`, `zip-filing.js`, `course-routes.js`,
  `thread-files.js`, `brain.js` and one line of `public/study.js`.

## What it does
- Each file from a zip keeps `folder` (`operation_b7/mission2`). A single upload has none.
- Code files already kept the end of their path in the name (`src/parser.c`); their folder label holds only the folders above
  that, so `folder/name` is the whole place in the zip with no folder twice (`filedFolder` in `zip-filing.js`).
- `course_files` shows `folder/name`; `course_read` and `open_on_pc` take `folder/name`, its end (`mission2/README.pdf`), the
  plain name when unique, or the id. Search results and the course material in the context cite `folder/name`.
- The course page's file list shows `folder/name`.
- **To fix files uploaded before this:** upload the same zip again. The summary says "I added folder names to N files you already had".

## Tests
`tests/zip-folders.test.js` (invented names only); `tests/brain-samename.test.js` still passes.
