# Thumber

A local Chrome extension for testing YouTube titles and thumbnails in context. It swaps one random video on the YouTube home feed or a search results page with your own title and thumbnail, so you can see how it holds up against the competition.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the extension and refresh any open YouTube tabs (requires Chrome 116+ for the side panel)

## Use

1. Click the Thumber icon to open it in the side panel, then add a thumbnail and type a title (changes apply live)
2. Open youtube.com or search for something: one of the first ~12 home tiles (or ~8 search results) gets swapped
3. **Shuffle slot** moves it to a different random video; **Reveal** scrolls to it and flashes a highlight
4. Use the toggle in the header to pause the swap

Settings are stored locally in `chrome.storage.local`. Images wider than 1280px are scaled down before saving.
