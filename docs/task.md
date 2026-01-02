# Task: Integrate Tournament Generator into index2.html

- [x] Debug Lower Bracket Layout (Rendering Race Condition) <!-- id: 14 -->
- [x] Fix Missing Names Bug (Script Crash) <!-- id: 13 -->
- [x] Add Tournament CSS to `index2.html` <!-- id: 7 -->
- [x] Add Tournament HTML Structure (Button + Container) <!-- id: 8 -->
- [x] Port Utility & Calculation Logic from `tornament.html` <!-- id: 9 -->
- [x] Implement `collectRealGroupRanks` Bridge Function <!-- id: 10 -->
- [x] Update `createBracketUI` to display real names and group ranks <!-- id: 11 -->
- [x] Verify functionality <!-- id: 12 -->

# Previous Tasks
- [x] Simplify Player Assignment Interaction <!-- id: 6 -->
- [x] Update Help Portal Content <!-- id: 5 -->
- [x] Tie-breaker UI Refactoring <!-- id: 3, 4 -->
- [x] Analysis & Review <!-- id: 0, 1, 2 -->

# New Requests
- [x] Player Management
    - [x] Add 'Add Player' Button UI
    - [x] Implement Persistent Storage (LocalStorage)
- [x] Player Management
    - [x] Add 'Add Player' Button UI
    - [x] Implement Persistent Storage (LocalStorage)
    - [x] Add Logic to Update Pool & State

# New Requests
- [x] Externalize Player Data
    - [x] Create `names.json`
    - [x] Update `index2.html` to load JSON
    - [x] Handle CORS/File Protocol limitations (Fallback)
- [x] Add 'Download JSON' feature for updates

- [x] Google Sheets Integration
    - [x] Plan Architecture (Google Apps Script)
    - [x] Create GAS Script (Code Snippet for User)
    - [x] Implement `exportToGoogleSheet(data)` in JS
    - [x] Update UI with 'Export' button

- [x] Fix Tournament Line Rendering Disappearance (Mobile/Scroll Resize) <!-- id: 15 -->

- [x] Implement Custom Confirm Modal for Export <!-- id: 16 -->
    - [x] Add Modal HTML/CSS
- [x] Implement Custom Confirm Modal for Export <!-- id: 16 -->
    - [x] Add Modal HTML/CSS
    - [x] Replace `confirm()` with custom UI logic
    - [x] Refactor to support Alert mode (Single button) for Success/Error messages

- [x] Implement Loading State for Export <!-- id: 17 -->
    - [x] Create Full-screen Loading Overlay (HTML/CSS)
    - [x] Integrate show/hide logic in `exportToGoogleSheet`

- [x] Implement Image Export (Capture) <!-- id: 18 -->
    - [x] Import `html2canvas`
    - [x] Add 'Save Image' button
    - [x] Implement full-area capture logic

