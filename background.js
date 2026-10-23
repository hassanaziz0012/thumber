// Open the side panel when the toolbar icon is clicked, instead of a popup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
