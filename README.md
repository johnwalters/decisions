# Fruit Decisions Lab

An image classification experiment using OpenAI's `POST /v1/decisions` endpoint and `gpt-6-luna`.

## Run locally

1. Install dependencies: `npm run install:ci`. The installer must run through npm so it can locate npm's executable.
2. Create `.env` containing `OPENAI_API_KEY=your-key` (ignored by Git). Never put this key in browser code.
3. Run `npm run dev` and open the printed local URL. Restart after configuring the key.

The app browses a 100-image sample (50 healthy, 50 rotten apples), sends one image at a time, shows probabilities and raw responses, groups images by prediction, compares predictions to dataset labels, and exports JSON. Bulk classification runs sequentially and can stop after the current request. No automatic API calls occur on page load.

## Dataset

Source: https://www.kaggle.com/datasets/muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten (version 1), listed CC0. Only the apple sample is bundled. Re-download with `python3 scripts/download-sample.py`, then run `node scripts/optimize-sample.mjs`. Source folder paths are recorded in `public/samples/manifest.json` for provenance, and never sent to OpenAI. Bundled images are resized to a maximum 1024 pixels for a smaller download; source paths identify the originals. Imported images are also resized before storage and submission.

Import JPEG, PNG, or WebP files, or a labeled folder. Folder names containing `healthy`/`fresh` or `rotten` supply comparison labels. Single file uploads are unlabeled. Each import is capped at 500 images and 20 MB per image. Results and imported previews are retained in IndexedDB in the current browser; export before clearing browser data. JSON exports contain records and API results, not imported image pixels. Preserve original files separately.

## Hosted configuration

Private hosting is managed through Sites. Set `OPENAI_API_KEY` as a **secret** in the Site runtime environment, then redeploy the saved version. The API key stays on the server. Until configured, the UI disables classification and displays setup guidance.

The app uses fixed choices `healthy`, `rotten`, and `unclear`. Instructions can be edited; each result records the exact instructions, model, elapsed time, and timestamp. API refusals are grouped separately and excluded from label agreement. Label agreement measures dataset-label matches, including `unclear` as a mismatch for binary labels. This visual experiment does not establish food safety.

## Verification

Run `npx tsc --noEmit` and `node /Users/johnwalters/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/scripts/build-site.mjs`. Live API verification requires an API key and is pending until one is configured.

## Healthy routing thresholds

Enable **Use thresholds** in the Healthy thresholds panel. An API Healthy result stays Healthy only when its healthy probability is at least the selected minimum and its rotten probability is at most the selected maximum (inclusive boundaries). Otherwise it routes to Unclear for review. Other API categories and refusals are unchanged. Defaults are 70% / 25%, with the rule initially disabled. Settings persist in this browser and apply instantly to all saved decisions without another API call. Groups, disagreement filtering, and label agreement use the routed result; the original API choice and response remain visible and unchanged. JSON exports include the current threshold settings and both original and routed categories. Reset experiment clears images and results but preserves threshold preferences.
