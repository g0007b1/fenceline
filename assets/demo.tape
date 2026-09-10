# fenceline walkthrough — render with `vhs assets/demo.tape` (brew install vhs).
# Expects a demo repo at ./demo-app; `npm run demo:seed` creates one.
Output assets/demo.gif
Output assets/demo.mp4

Set Shell "bash"
Set FontSize 15
Set FontFamily "JetBrains Mono"
Set Width 1180
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 22
Set Margin 10
Set MarginFill "#1e1e2e"
Set WindowBar Colorful
Set BorderRadius 10
Set TypingSpeed 35ms
Set Framerate 24
Set CursorBlink false

Hide
Type "cd demo-app && clear" Enter
Show

Type "npx fenceline scan" Sleep 400ms Enter
Wait+Screen /Fragile zones/ Sleep 3s

Type "clear" Enter
Type "npx fenceline init" Sleep 400ms Enter
Wait+Screen /Enforced:/ Sleep 3500ms

Type "clear" Enter
Type "npx fenceline doctor" Sleep 400ms Enter
Wait+Screen /releases the agent/ Sleep 3500ms

Type "clear" Enter
Type@50ms `npx fenceline triage "Add a refund flow with Stripe and a new payments table"` Sleep 400ms Enter
Wait+Screen /HUMAN/ Sleep 2500ms

Type "clear" Enter
Type@50ms `npx fenceline triage "Remove the header on the bookings table screen. Given the page loads, then no header is rendered."` Sleep 400ms Enter
Wait+Screen /AUTO/ Sleep 3500ms
