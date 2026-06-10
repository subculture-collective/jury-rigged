# Jury Rigged UI Notes

## Whole UI

- the breakpoints shouldn't happen so fast

## Header

- remove the description of the page, just use Dashboard, Transcripts, Submit Prompt, Overlay (should be called something else), About.

## Dashboard

- The square next to LIVE COURT is not lined up
- The Turns, Length, Evidence, Objections length is overflowing and cards would be overflowing but it is on the next line, it doesnt look great, maybe put the whole values on the next line for all 4
- The LiveFeed should scroll and move to the bottom on new turns.
- If I click a session, it takes me to the Transcripts page, but the transcript view remains empty

## Transcripts

- while empty and in single column layout, the transcript view should be small, the transcript view should 
- the ui over flows the screen to the right in single column mode
- when a transcript is selected, it should scroll all the way to the top. the transcript view should be limited in height and scrollable

## Submit Prompt

- the main view, header and footer should fill the viewport

## About

- the same viewport issue
- remove the gradient in the top

## Auth/Admin

- The auth and admin dashboard need the new style.
- don't just recreate the existing pages, rethink what pages need to exist and what information they should contain, more information is always better.
- you can be as destructive as necessary as well as constructive, new routes, delete routes, anything goes make it a useful and informative dashboard and try to incorporate as much information that we expose as possible.
- make sure that you can easily navigate back and forth between the public and admin areas.
