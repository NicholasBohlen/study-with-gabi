# Study with Gabi

A small study app that runs on a phone. Each day it shows what to study, then gives flashcards and a quiz for each topic. It works offline once it has been opened, needs no accounts, and saves progress on the phone.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The app |
| `content.json` | **The study material.** This is the only file you change each semester. |
| `sw.js`, `manifest.webmanifest`, icons | Make it installable and work offline |

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
- **Each topic:** key points, then flashcards (cards she marks "Again" come back a few cards later), then a quiz with explanations.
- **Spacing:** the quiz score decides when a topic comes back. Under 60% returns the next day, 60 to 79% in 3 days, and 80% or higher in 7 days.
- **Last study day:** a mixed final quiz across everything, weighted toward her weakest topics. This can be turned off in Settings.
- **Missed days:** unfinished topics show as "Carried over." **Save and rebuild plan** in Settings spreads them over the days left.

## Updating content (new semester or new slides)

Replace `content.json` in the repository. She gets the update the next time she opens the app with internet. Updates show on the second launch, because the app opens the saved copy first and downloads the new one in the background.

- A new `id` at the top starts fresh progress, which is what you want for a new semester.
- Keep the same `id` to add topics mid-break. Existing progress stays, and new topics are added to the plan.
- If you change `app.js` or `styles.css`, bump `CACHE` in `sw.js` (for example to `study-with-gabi-v2`) so phones pick up the change.

### content.json format

```json
{
  "id": "fall-2026",
  "title": "Fall 2026 review",
  "defaults": { "offDays": [0], "finalReview": true },
  "topics": [
    {
      "id": "unique-topic-id",
      "block": "Cardio",
      "title": "Topic name",
      "source": "Lectures 3-4",
      "points": ["Key point", "Key point"],
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

`answer` is the position of the correct option, counting from 0. The app shuffles the options. Topics go on the plan in the order they're listed.

## Progress and backup

Progress lives in the phone's browser storage. Use **Settings > Export progress** to back it up or move it to a new phone. Deleting the home-screen app or clearing Safari/Chrome website data erases progress.

## Privacy

The repo is public, so anyone can view the code and content.json. Only people you add as collaborators can change it. Don't commit the original slide files, and keep the cards and questions in your own words.
