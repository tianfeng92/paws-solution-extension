# ![Paws Solution](/paws-solution.png) PAWS Solution - CI Failure Analyzer

## Description

PAWS Solution is a Chrome extension designed to help developers quickly diagnose failed CI/CD jobs on Semaphore. It reads the log output of a failed job, sends a relevant snippet to the Gemini API for analysis, and displays a concise summary of the root cause and a suggested solution directly on the Semaphore page.

This tool saves developers time by eliminating the need to manually scan through large log files to find the source of an error.

## How to Build

This project is built using TypeScript and requires a build step to compile the TypeScript files into JavaScript.

1.  **Install Dependencies:**
    Navigate to the project's root directory and install the required packages using `npm`.

    ```
    npm install
    ```

2.  **Build the Extension:**
    Run the build command. This will compile the TypeScript files (`.ts`) into JavaScript (`.js`) and place them in a `dist` directory, ready to be loaded by Chrome.

    ```
    npm run build
    ```

## How to Load in Dev Mode

To test the extension locally, you can load it into Chrome as an "unpacked extension."

1.  Open Google Chrome and navigate to the extensions page by typing `chrome://extensions` in the address bar.
2.  Enable **"Developer mode"** using the toggle switch in the top-right corner of the page.
3.  Click the **"Load unpacked"** button that appears.
4.  In the file selection dialog, navigate to your project's directory and select the `dist` folder (or whichever folder contains your compiled `manifest.json`, `popup.html`, etc.).
5.  The "PAWS Solution" extension will now appear in your list of extensions and be active in your browser.
