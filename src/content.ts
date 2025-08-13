console.log("PAWS Solution: Content script loaded.");

// --- Global variable to store the original log content ---
let originalLogContent: HTMLElement | null = null;

/**
 * Creates the "Paws Solution" tab and manages the display of content panes.
 */
const setupUI = () => {
  const tabsContainer = document.querySelector("#main-content .tabs");
  const jobLogContainer = document.querySelector(".job-log-container");

  if (!tabsContainer || !jobLogContainer) {
    console.error(
      "PAWS Solution: Could not find the necessary Semaphore UI elements.",
    );
    return;
  }

  if (document.getElementById("paws-solution-tab")) return; // Already created

  // 1. Find the original "Job log" tab
  let jobLogTab: HTMLElement | null = null;
  for (const tab of tabsContainer.querySelectorAll("a.tab")) {
    if (tab.textContent?.includes("Job log")) {
      jobLogTab = tab as HTMLElement;
      break;
    }
  }

  if (!jobLogTab) {
    console.error("PAWS Solution: Could not find the 'Job log' tab.");
    return;
  }

  // --- Store the original log content ---
  originalLogContent = jobLogContainer.cloneNode(true) as HTMLElement;

  // 2. Create the new "Paws Solution" tab
  const newTab = document.createElement("a");
  newTab.id = "paws-solution-tab";
  newTab.href = "#";
  newTab.className = "tab";
  newTab.innerHTML = "🐾 Paws Solution";

  // 3. Insert the new tab into the page
  tabsContainer.appendChild(newTab);

  // 4. Add click handlers for tab switching
  newTab.addEventListener("click", (e: MouseEvent) => {
    e.preventDefault();
    // --- NEW: Load preloaded result on click ---
    (jobLogContainer as HTMLElement).innerHTML =
      `<div id="paws-analysis-container" style="padding: 20px; font-family: monospace; white-space: pre-wrap; background-color: #f5f5f5; border-radius: 5px;">Loading analysis...</div>`;

    const jobId = getJobId();
    if (jobId) {
      const cacheKey = `analysis_${jobId}`;
      chrome.storage.local.get(cacheKey, (data) => {
        if (data[cacheKey]) {
          displayAnalysis(data[cacheKey]);
        } else {
          displayAnalysis(
            "Analysis is still in progress. Please wait a moment and try again.",
          );
        }
      });
    }
  });

  jobLogTab.addEventListener("click", (e: MouseEvent) => {
    e.preventDefault();
    if (originalLogContent) {
      (jobLogContainer as HTMLElement).innerHTML = originalLogContent.innerHTML;
    }
  });
};

/**
 * Displays the analysis result in the "Paws Solution" tab.
 */
const displayAnalysis = (analysis: any) => {
  const analysisContainer = document.getElementById("paws-analysis-container");
  if (analysisContainer) {
    if (analysis.summary && analysis.rootCause && analysis.solution) {
      const tableHTML = `
                <table style="width: 100%; border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid #ddd;">
                        <td style="padding: 10px; font-weight: bold; width: 120px; vertical-align: top;">Summary</td>
                        <td style="padding: 10px;">${analysis.summary}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #ddd;">
                        <td style="padding: 10px; font-weight: bold; vertical-align: top;">Root Cause</td>
                        <td style="padding: 10px;">${analysis.rootCause}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; font-weight: bold; vertical-align: top;">Solution</td>
                        <td style="padding: 10px; white-space: pre-wrap; font-family: monospace;">${analysis.solution}</td>
                    </tr>
                </table>
            `;
      analysisContainer.innerHTML = tableHTML;
    } else {
      const formattedJson = JSON.stringify(analysis, null, 2);
      analysisContainer.innerHTML = `<pre>${formattedJson}</pre>`;
    }
  }
};

// --- Main Logic ---

const getJobId = (): string | null => {
  const jobUrlPattern =
    /https:\/\/tigera\.semaphoreci\.com\/jobs\/([a-f0-9-]+)/;
  const match = window.location.href.match(jobUrlPattern);
  return match ? match[1] : null;
};

const isJobFailed = (): boolean => {
  const failedBadge = document.querySelector(
    'div[data-poll-state="done"] span.bg-red',
  );
  return !!(
    failedBadge && failedBadge.textContent?.trim().toLowerCase() === "failed"
  );
};

const runAnalysisInBackground = () => {
  const jobId = getJobId();
  if (!jobId) return;

  console.log(`PAWS Solution: Preloading analysis for Job ID: ${jobId}.`);
  chrome.runtime.sendMessage(
    { action: "analyze_log", jobId: jobId },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("PAWS Solution:", chrome.runtime.lastError.message);
      } else {
        console.log("PAWS Solution: Background analysis complete.", response);
      }
    },
  );
};

const main = () => {
  chrome.storage.local.get({ isEnabled: true }, (data) => {
    if (data.isEnabled) {
      // --- NEW: Check for authentication before doing anything ---
      chrome.runtime.sendMessage({ action: "check_auth" }, (response) => {
        if (response?.isLoggedIn) {
          console.log(
            "PAWS Solution: User is signed in. Proceeding with checks.",
          );
          setTimeout(() => {
            if (isJobFailed()) {
              setupUI();
              runAnalysisInBackground(); // Start the analysis immediately
            }
          }, 1000); // Wait for the page to load
        } else {
          console.log(
            "PAWS Solution: User is not signed in. No UI will be added.",
          );
        }
      });
    }
  });
};

// Run main logic on initial load
main();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "toggle_analysis" && message.isEnabled) {
    if (isJobFailed()) {
      setupUI();
      runAnalysisInBackground();
    }
  }
});
