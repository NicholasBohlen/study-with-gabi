# Study with Gabi

A small study app that runs on a phone. Each day it shows what to study, then gives flashcards and a quiz for each topic. It works offline once it has been opened, needs no accounts, and saves progress on the phone.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The app |
| `content.json`, `courses/` | **The study material:** the list of classes, and one file of topics per class. |
| `sw.js`, `manifest.webmanifest`, icons | Make it installable and work offline |
| `slides/` | Drop source PowerPoints/PDFs here to turn into content.json. Never uploaded (listed in `.gitignore`). |

## Put it online (GitHub Pages, free, about 15 minutes)

1. Make a GitHub account if you don't have one.
2. Create a new repository, for example `study-with-gabi`. If you want the material hidden from search, see the note on privacy below.
3. Upload every file in this folder to the repository's main branch.
4. Go to **Settings > Pages**. Under "Build and deployment," set Source to **Deploy from a branch**, then pick **main** and **/ (root)**. Save.
5. After a minute or two, the site is at `https://<your-username>.github.io/study-with-gabi/`.

## Install on her phone

1. Open the link once **while she has internet**. That saves everything for offline use.
2. **iPhone:** open the link in Safari, tap Share, then **Add to Home Screen**.
   **Android:** open the link in Chrome, tap the ⋮ menu, then **Add to Home screen** or **Install app**.
3. From then on, she opens it from the icon. It works with no signal.
4. First time: go to **Settings**, enter the break start and end dates and any days off, then tap **Save and rebuild plan**.

## How it works

- **Today:** the topics planned for today, anything carried over from missed days, and up to 3 review topics that are due.
- **Calendar:** the whole break as a month view. Each day shows a dot per topic in its block's color (faint = planned, solid = done, orange ring = behind). Tap a day to see its topics and reviews.
- **Topics:** the classes she's studying now (or all of them, by semester), with progress per class and when each topic is planned or due for review.
- **Each topic:** key points, then flashcards (cards she marks "Again" come back a few cards later), then a quiz with explanations.
- **In depth:** for a topic she doesn't know yet, or scored under 80% on: the questions she missed with the right answers, the notes, every card laid out, and worked questions to check herself on. Linked from the topic page, the quiz score, and the end of the flashcards when she missed some.
- **Spacing:** the quiz score decides when a topic comes back. Under 60% returns the next day, 60 to 79% in 3 days, and 80% or higher in 7 days.
- **Last study day:** a mixed final quiz across everything, weighted toward her weakest topics. This can be turned off in Settings.
- **Missed days:** unfinished topics show as "Carried over." **Save and rebuild plan** in Settings spreads them over the days left.

## Updating content (new semester, new class, new slides)

Content is a library of classes. `content.json` lists them, and each class's topics live in their own file under `courses/`. She picks what she's studying now in **Settings > Studying now** (grouped by semester), and Today, the calendar and quizzes use only those. Progress on every class is kept, so old material is still there under **Topics > All courses**.

- **New class or semester:** add its file under `courses/` and a line for it in `content.json`. Put newer semesters last. The newest semester's classes are picked by default; `"current": true` on a class overrides that.
- **New topics mid-break:** add them to the class's file. Progress stays and they join the plan.
- **Don't change** a class's or topic's `id` once she's used it. Progress is tied to them. Keep the top-level `id` the same too; changing it starts every class from zero.
- She gets changes the next time she opens the app with internet.

### content.json

```json
{
  "id": "gabi",
  "title": "Study with Gabi",
  "defaults": { "offDays": [0], "finalReview": true },
  "courses": [
    { "id": "fall-2026-cardio", "term": "Fall 2026", "title": "Cardiology", "file": "courses/fall-2026-cardio.json" },
    { "id": "spring-2027-renal", "term": "Spring 2027", "title": "Renal", "file": "courses/spring-2027-renal.json" }
  ]
}
```

### A class file (courses/....json)

```json
{
  "topics": [
    {
      "id": "unique-topic-id",
      "block": "Cardio",
      "title": "Topic name",
      "source": "Lectures 3-4",
      "points": ["Key point", "Key point"],
      "notes": [{ "heading": "Section", "text": "Longer explanation.\n\n- A bullet\n- Another bullet" }],
      "cards": [{ "front": "Question", "back": "Answer" }],
      "questions": [{
        "q": "Question stem",
        "options": ["A", "B", "C", "D"],
        "answer": 1,
        "explanation": "Why B is right"
      }]
    }
  ]
}
```

`answer` is the position of the correct option, counting from 0. The app shuffles the options. Topics go on the plan in the order they're listed. `notes` is optional: the fuller explanation shown on the in-depth page (a blank line starts a new paragraph, lines starting "- " are bullets).

## Progress and backup

Progress lives in the phone's browser storage. Use **Settings > Export progress** to back it up or move it to a new phone. Deleting the home-screen app or clearing Safari/Chrome website data erases progress.

## Privacy

The repo is public, so anyone can view the code and content.json. Only people you add as collaborators can change it. Don't commit the original slide files, and keep the cards and questions in your own words.
