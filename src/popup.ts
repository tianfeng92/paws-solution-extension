// Define interfaces for message responses to ensure type safety
interface AuthSuccessResponse {
  status: "success";
  email: string;
}

interface AuthCheckResponse {
  isLoggedIn: boolean;
  email?: string;
}

/**
 * Displays the analysis result in a table within the popup.
 * @param analysis - The analysis object.
 */
const displayAnalysisInPopup = (analysis: any) => {
  const container = document.getElementById("popup-analysis-container");
  const content = document.getElementById("popup-analysis-content");

  if (container && content) {
    if (analysis.summary && analysis.rootCause && analysis.solution) {
      const tableHTML = `
                <table style="width: 100%; border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 8px; font-weight: bold; vertical-align: top;">Summary</td>
                        <td style="padding: 8px;">${analysis.summary}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 8px; font-weight: bold; vertical-align: top;">Root Cause</td>
                        <td style="padding: 8px;">${analysis.rootCause}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; font-weight: bold; vertical-align: top;">Solution</td>
                        <td style="padding: 8px; white-space: pre-wrap; font-family: monospace;">${analysis.solution}</td>
                    </tr>
                </table>
            `;
      content.innerHTML = tableHTML;
    } else {
      content.textContent = JSON.stringify(analysis, null, 2);
    }
    container.style.display = "block";
  }
};

// Wait for the popup's HTML content to be fully loaded before running the script.
document.addEventListener("DOMContentLoaded", () => {
  const enableToggle = document.getElementById(
    "enable-toggle",
  ) as HTMLInputElement;
  const loginButton = document.getElementById(
    "login-button",
  ) as HTMLButtonElement;
  const authStatus = document.getElementById(
    "auth-status",
  ) as HTMLParagraphElement;

  // --- Enable/Disable Toggle Logic ---
  chrome.storage.local.get({ isEnabled: true }, (data) => {
    enableToggle.checked = !!data.isEnabled;
  });

  enableToggle.addEventListener("change", () => {
    chrome.storage.local.set({ isEnabled: enableToggle.checked });
  });

  // --- Login/Logout Button Logic ---
  loginButton.addEventListener("click", () => {
    if (loginButton.textContent?.includes("Sign in")) {
      // --- Handle Login ---
      chrome.runtime.sendMessage(
        { action: "login" },
        (response: AuthSuccessResponse | undefined) => {
          if (response?.status === "success") {
            authStatus.textContent = `Signed in as ${response.email}`;
            loginButton.textContent = "Sign Out";
          }
        },
      );
    } else {
      // --- Handle Logout ---
      chrome.runtime.sendMessage({ action: "logout" }, (response) => {
        if (response?.status === "success") {
          authStatus.textContent = "Not signed in.";
          loginButton.textContent = "Sign in with Google";
        }
      });
    }
  });

  // --- Check Auth and Analysis Result on Popup Open ---
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (currentTab?.url) {
      const jobUrlPattern =
        /https:\/\/tigera\.semaphoreci\.com\/jobs\/([a-f0-9-]+)/;
      const match = currentTab.url.match(jobUrlPattern);
      if (match) {
        const jobId = match[1];
        const cacheKey = `analysis_${jobId}`;
        chrome.storage.local.get(cacheKey, (data) => {
          if (data[cacheKey]) {
            displayAnalysisInPopup(data[cacheKey]);
          }
        });
      }
    }
  });

  chrome.runtime.sendMessage(
    { action: "check_auth" },
    (response: AuthCheckResponse | undefined) => {
      if (response?.isLoggedIn) {
        authStatus.textContent = `Signed in as ${response.email}`;
        loginButton.textContent = "Sign Out";
      }
    },
  );
});
