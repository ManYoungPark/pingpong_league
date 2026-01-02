# Walkthrough - Tournament Generation Integration

I have successfully integrated the tournament generation logic into `index2.html`. This feature allows you to seamlessly transition from the group stage (Round Robin) to the final tournament phase.

## New Features

### 1. Tournament Generation Control
-   **Where**: "Settings" Control Panel.
-   **Action**: Clicking **'🏆 본선 토너먼트 생성'** reads the current group rankings.
-   **Validation**: It alerts you if no players are assigned to groups.

### 2. Automatic Data Bridging
-   **Logic**: The system automatically sorts players by their **Final Rank** (including Manual adjustments and Tie-breakers).
-   **Splitting**: 
    -   **Upper Bracket**: Top 50% (rounded up) of each group.
    -   **Lower Bracket**: The remaining players.
-   **Seeding**: Players are seeded to avoid same-group matchups in Round 1 where possible.

### 3. Interactive Bracket UI
-   **Display**: Two separate bracket sections (Upper / Lower).
-   **Content**: Each player box shows the **Player Name** and their source rank (e.g., `1조 1위`).
-   **Interaction**: Click on a player's box to select them as the winner of the match. The winner advances automatically to the next round.
-   **Visualization**: Winning paths highlight in **Red**, losing paths become dotted/gray.

### 4. Player Management
-   **Add Player**: Click **'+ 이름 추가'** in the 'Pool' card header to add new participants dynamically.
-   **Persistence**: Added names are stored in `localStorage`, so they remain even after refreshing the page.
-   **Export**: Click **'💾 저장'** to download the current name list as a `names.json` file, which can be used to back up or update the base data.

### 5. Google Sheets Export
- **Integration**: Provides a direct way to save tournament results to Google Sheets via Apps Script.
- **Workflow**:
    1. Enter GAS Web App URL in the dashboard input.
    2. Click **'📤 구글 시트 저장'**.
    3. System calculates points (+2 Participation, +5 Winning etc) and sends data.
- **Point System**:
    - **Participation**: +2 pts (Everyone in a team)
    - **Upper Bracket**: Winner(+5), Runner-up(+4), Semi-Final(+3)
    - **Lower Bracket**: Winner(+4), Runner-up(+3)

### 6. Enhanced UI
- **Custom Confirm Dialog**: Replaced the native browser alert with a styled, centered modal for cleaner "Google Sheets Export" confirmation. Displays a clear summary of winners before sending data.
- **Loading Overlay**: While data is being sent to Google Sheets, a full-screen spinning loading indicator appears. This blocks other interactions to prevent double-submission and clearly indicates background activity.
- **Image Export**: "📷 이미지 저장" button allows users to download the entire tournament bracket results as a PNG file for sharing (e.g., on Band). It captures the full scrollable area.

## Usage Guide

1.  **Assign Players**: Drag players or click names to assign them to groups (2~6 Groups).
2.  **Enter Scores**: Input match results to determine rankings. Use the Manual Rank feature if needed for ties.
3.  **Generate**: Click the **'🏆 본선 토너먼트 생성'** button.
4.  **Run Tournament**: Scroll down to see the generated brackets. Click winners to progress to the Champion.
5.  **Export**: When finished, enter the Google Script URL and click 'Export' to save to Cloud.

## Technical Details (Implementation)
-   **Integrated `tornament.html` Logic**: Ported the seed generation, bracket resizing (`nextPow2`), and SVG rendering engine.
-   **Dynamic Rendering**: Uses `requestAnimationFrame` / timeout strategy to ensure SVG lines draw correctly after the container becomes visible.
-   **Data Bridge**: `collectRealGroupRanks()` extracts live `state` and `resultsByTeam` data.
-   **GAS Integration**: `exportToGoogleSheet()` utilizes `fetch` with `no-cors` mode to communicate with Google Apps Script Web App.

## Verification
-   [x] Verified that clicking "Generate" without players shows an error alert.
-   [x] Verified that Upper/Lower brackets split correctly based on group size.
-   [x] Verified that player names and source ranks are displayed correctly.
-   [x] Verified that clicking winners advances them visually with correct SVG updates.
-   [x] Tested Google Sheets Export using dummy data and confirmed successful data insertion.
-   [x] Fixed: Tournament lines no longer reset to default color when resizing window (or scrolling on mobile). `restoreStyles()` now persists the red winning path.
