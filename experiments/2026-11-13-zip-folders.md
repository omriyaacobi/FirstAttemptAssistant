# Folders for course files, kept as labels (2026-11-13)

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

# Part 2: folders for every road (asked the same day: "a general better organization for files in the study section")

## Options considered
- **A. Labels only, one field per file (CHOSEN).** Every file record may have `folder` ("Week 3/Lab files"). There is no folder
  object: a folder exists while a file carries it, so an "empty folder" cannot exist and nothing has to be kept in step.
- B. A folder list per course (folders as their own records, files point to them). Allows empty folders and folder colours,
  but every move and delete must keep two lists in step, and old records need a migration. More code for little gain now.
- C. Real folders on disk. Rejected: a zip or Moodle name would become a path (the rule says never), and moving would touch files.

## What each road does (A)
| Road | Folder label |
|---|---|
| Single upload on the course page | none (top level) |
| File sent in chat (`thread-files.js`) | none |
| Zip (page, chat, link, GitHub) | the folder inside the zip |
| Moodle download (`moodle-tools.js`) | the Moodle section ("Week 3"; "Section 0" when it has no title); a file inside a Moodle folder item adds that item's name ("Week 3/Lab files"). A "/" inside a Moodle title becomes "-", so a title cannot make deeper folders. A zip from Moodle goes under the section, its own folders below. |
| Saved link (`save_link`) | none for a single file; a zip or GitHub repo keeps its zip folders |
| Link batch (`save_links`) | same as a saved link (NOT built: the source file's name as a folder was considered, see Proposals) |

## Moving and renaming (built)
Brain tool `file_folder` (doing-tool, acts at once): `{course, file, folder}` moves one file or a list (up to 50) into a folder
("" = top); `{course, from, to}` renames a folder and everything under it ("week1" never touches "week10"). Files are picked by
code (`pickFiles`, each must fit exactly one); the folder text is cleaned by code (`cleanFolder`); refused after a web page, a
photo or Moodle text in the same message (`afterWeb`), like the other doing-tools. Its answer says the old folder, so asking to
move it back undoes it. Nothing on disk moves.

## The page
The file list shows `folder/name` (one line changed). A Hebrew folder shows right to left (correct reading order).

## The brain
`course_files` shows `folder/name`; `course_read`, `open_on_pc` and `file_folder` take the id, `folder/name`, its end
(`mission2/README.pdf`) or the plain name when unique; search results and the course material in the context cite `folder/name`.

## Also fixed on the way
Zip names WITHOUT the zip's UTF-8 flag are now read as UTF-8 when their bytes are valid UTF-8 (macOS and many tools write them
that way). Before, a Hebrew file or folder name from such a zip turned into garbage like "×\x9E×\x98...". Bytes that are not
valid UTF-8 are read as Latin-1, as before.

## Proposals for Omri (NOT built)
1. **Group the page's list by folder** (a small header per folder, folders collapsible). Today the list is in upload order with
   `folder/name` on each row. Needs page design work, so it is left for Omri / Improve Bot.
2. **Move or rename from the page** (a button per row). Today only by asking Bot in the chat.
3. **Link batch folder:** file the links of one batch under the source file's name ("reading list").
4. **Folder for a single upload chosen on the page** (a box "into folder").

## What was tested (2026-11-13)
- Unit tests: `tests/zip-folders.test.js`, `tests/folders-general.test.js` (Moodle sections with a fake bridge; file_folder move,
  rename, refusals and the web-page block; an OLD course record with 14 files and no folders: unchanged, then a re-upload
  labels all 14 with no copies and no file added, lost or renamed on disk, then a restart reads the same; empty folders; a deep
  path; a name over 200 characters (skipped, an old unzip rule); Hebrew folders; the same file in two folders; 200 files in 20
  folders; deleting a file).
- End to end on a temporary copy of the branch (port 3102; 3100 was taken by another process; models pointed at missing files;
  a fresh data folder): course page single uploads, the assignment zip, the same zip again (labels added to 2 old files, then
  "14 were already in the course"), a chat file, a chat zip, the edge zip and the 200-file zip (the course limit of 200 files
  stopped 3, as it should). Checked the stored records, the page list in the built-in browser (desktop and phone width), delete
  through the server route, and the brain's course_files, course_read, course_search, open_on_pc (fake opener) and file_folder
  over that data folder (rename "week1" -> "Week 01" shown on the page; "week10" left "week11".."week19" alone).
- Not tested: a real Moodle (only a fake bridge), a real model choosing these tools, the page's own Delete button (it opens a
  browser confirm dialog; the same server route was called directly instead).
