// --- Log the Extension ID for Debugging ---
// This will print the extension's ID to the service worker console,
// so you can verify it against the ID in your Google Cloud project.
console.log("PAWS Solution running:", chrome.runtime.id);

// --- Type Definitions for Clarity ---
interface LoginMessage {
  action: "login";
}

interface LogoutMessage {
  action: "logout";
}

interface CheckAuthMessage {
  action: "check_auth";
}

interface AnalyzeLogMessage {
  action: "analyze_log";
  jobId: string;
}

// Union type for all possible messages
type RuntimeMessage =
  | LoginMessage
  | LogoutMessage
  | CheckAuthMessage
  | AnalyzeLogMessage;

// --- Main Message Listener ---
chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    switch (message.action) {
      case "login":
        // Start the OAuth flow. 'interactive: true' will prompt the user with a login screen.
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError || !token) {
            console.error("Login failed:", chrome.runtime.lastError?.message);
            sendResponse({
              status: "error",
              message: chrome.runtime.lastError?.message,
            });
            return;
          }
          // After getting a token, get the user's email to display in the popup.
          fetchUserInfo(token).then((email) => {
            sendResponse({ status: "success", email: email });
          });
        });
        // Return true to indicate that we will send a response asynchronously.
        return true;

      case "logout":
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (token) {
            // Revoke the token
            chrome.identity.removeCachedAuthToken({ token: token }, () => {
              // Also clear it from Google's side
              fetch(
                `https://accounts.google.com/o/oauth2/revoke?token=${token}`,
              );

              // Clear all cached analysis results after logout.
              chrome.storage.local.get(null, (items) => {
                const keysToRemove = Object.keys(items).filter((key) =>
                  key.startsWith("analysis_"),
                );
                if (keysToRemove.length > 0) {
                  chrome.storage.local.remove(keysToRemove, () => {
                    console.log(
                      "PAWS Solution: Cleared cached analysis on logout.",
                    );
                  });
                }
              });

              console.log("PAWS Solution: User signed out.");
              sendResponse({ status: "success" });
            });
          }
        });
        return true;

      case "check_auth":
        // Checks if the user is already signed in.
        // 'interactive: false' gets a token silently if available.
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (token) {
            fetchUserInfo(token).then((email) => {
              sendResponse({ isLoggedIn: true, email: email });
            });
          } else {
            sendResponse({ isLoggedIn: false });
          }
        });
        return true;

      case "analyze_log":
        handleLogAnalysis(message.jobId, sendResponse);
        return true;
    }
  },
);

async function handleLogAnalysis(
  jobId: string,
  sendResponse: (response?: any) => void,
) {
  try {
    // Construct a unique cache key based on the job ID.
    const cacheKey = `analysis_${jobId}`;

    // 1. Check the cache first.
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      sendResponse({ status: "success", analysis: cachedResult });
      return cachedResult;
    }

    // 2. Get auth token for the Gemini API call.
    const token = await new Promise<string | undefined>((resolve) => {
      // Use interactive:false, assuming the user has already logged in via the popup.
      chrome.identity.getAuthToken({ interactive: false }, resolve);
    });

    if (!token) {
      throw new Error(
        "Authentication failed. Please sign in using the extension popup.",
      );
    }

    // 3. Fetch the plain text log file.
    const logUrl = `https://tigera.semaphoreci.com/jobs/${jobId}/plain_logs.txt`;
    const logResponse = await fetch(logUrl);
    if (!logResponse.ok) {
      throw new Error(`Failed to fetch logs: ${logResponse.statusText}`);
    }
    const logContent = await logResponse.text();

    // 4. Pre-process the log to find relevant error snippets.
    const errorSnippet = findErrorSnippet(logContent);
    if (!errorSnippet) {
      sendResponse({
        status: "success",
        analysis: { summary: "No obvious errors were found in the log." },
      });
      return;
    }

    const analysis = await callGeminiAPI(errorSnippet, token);
    await saveToCache(cacheKey, analysis);
    sendResponse({ status: "success", analysis: analysis });
  } catch (error: any) {
    console.error("Analysis failed:", error);
    sendResponse({ status: "error", message: error.message });
  }
}

/**
 * Find the most relevant error part of a log.
 * It prioritizes structured, high-confidence error patterns and filters out
 * common noise like warnings and help text.
 */
function findErrorSnippet(logContent: string): string | null {
  const lines = logContent.split("\n");
  const contextLines = 10; // Number of lines to include before and after the error.

  // Priority 1: Look for a "Results summary" block with failures.
  const summaryHeaderIndex = lines.findIndex((line) =>
    line.includes("===== Results summary ====="),
  );
  if (summaryHeaderIndex !== -1) {
    let summaryEndIndex = lines.findIndex(
      (line, index) => index > summaryHeaderIndex && line.startsWith("====="),
    );
    if (summaryEndIndex === -1) {
      summaryEndIndex = lines.length;
    }
    const summaryBlock = lines.slice(summaryHeaderIndex, summaryEndIndex);
    const failedTestLine = summaryBlock.find((line) => line.includes("FAILED"));
    if (failedTestLine) {
      console.log("PAWS Solution: Found FAILED test in results summary.");
      return summaryBlock.join("\n");
    }
  }

  // Look for high-confidence patterns (e.g., build tool errors).
  const highConfidencePatterns = [
    /make\[\d+\]: \*\*\* .* Error \d+/, // Match 'make' errors
    /ERROR: failed to solve:/, // Match Docker buildx errors
    /fatal error:/, // Match fatal compiler/runtime errors
    /panic:/, // Match Go panics
  ];

  for (const pattern of highConfidencePatterns) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (pattern.test(lines[i])) {
        // Special handling for 'check-dirty' to avoid sending the diff.
        if (lines[i].includes("check-dirty")) {
          console.log(
            "PAWS Solution: Found 'check-dirty' error. Excluding preceding diff.",
          );
          // For a check-dirty error, the context AFTER the error is more important.
          const start = Math.max(0, i - 5); // Take only 5 lines before
          const end = Math.min(lines.length, i + 50); // Take 50 lines after
          return lines.slice(start, end).join("\n");
        }

        console.log(
          "PAWS Solution: Found high-confidence error pattern:",
          pattern,
        );
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines);
        return lines.slice(start, end).join("\n");
      }
    }
  }

  // Priority 3: Fallback to generic keywords, filtering out noise.
  const exclusionPatterns = [
    /warning:/i,
    /^usage:/i,
    /^flags:/i,
    /global flags:/i,
    /unauthorized:/i, // Often a symptom, not a root build failure
  ];

  const genericKeywords = ["error", "failed", "exit code"];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].toLowerCase();
    let keywordFound = false;
    for (const keyword of genericKeywords) {
      if (line.includes(keyword)) {
        keywordFound = true;
        break;
      }
    }

    if (keywordFound) {
      let isExcluded = false;
      for (const pattern of exclusionPatterns) {
        if (pattern.test(line)) {
          isExcluded = true;
          break;
        }
      }

      if (!isExcluded) {
        console.log(
          "PAWS Solution: Found generic error keyword on line:",
          line,
        );
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines);
        return lines.slice(start, end).join("\n");
      }
    }
  }

  // Final Fallback:
  // If no specific errors are found at all, return the last 20 lines.
  console.log(
    "PAWS Solution: No specific errors found, returning last 20 lines.",
  );
  return lines.slice(-20).join("\n");
}

// Calls the Gemini API to analyze the log snippet.
async function callGeminiAPI(logSnippet: string, token: string): Promise<any> {
  const PROJECT_ID = "PROJECT_ID_PLACEHOLDER";
  const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

  const prompt = `
      You are an expert CI/CD debugger analyzing a failed Semaphore CI job log.
      Your task is to:
      1. Identify the single, primary root cause of the failure from this log snippet.
      2. Provide a brief, one-sentence summary of the error.
      3. Suggest a concrete, actionable solution, including specific commands if applicable.
      Format your response as a JSON object with three keys: "rootCause", "summary", and "solution".
      Here is the relevant log snippet:
      ---
      ${logSnippet}
      ---
    `;

  const response = await fetch(GEMINI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID, // Required for GCP APIs when using OAuth.
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gemini API failed with status: ${response.statusText}. Body: ${errorBody}`,
    );
  }

  const data = await response.json();
  const jsonString = data.candidates[0].content.parts[0].text.replace(
    /^```json\n|```$/g,
    "",
  );
  return JSON.parse(jsonString);
}

// Fetches the user's email address using the OAuth token.
async function fetchUserInfo(token: string): Promise<string | null> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.statusText}`);
    }
    const data = await response.json();
    return data.email || null;
  } catch (error) {
    console.error("Error fetching user info:", error);
    // If the token is invalid, remove it from the cache.
    chrome.identity.removeCachedAuthToken({ token: token }, () => {});
    return null;
  }
}

/**
 * Retrieves data from Chrome's local storage.
 * This helper function encapsulates the asynchronous storage API call.
 * @param {string} key The key to retrieve.
 * @returns {Promise<string|null>} The cached data or null if not found.
 */
async function getFromCache(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

/**
 * Saves data to Chrome's local storage.
 * This helper function encapsulates the asynchronous storage API call.
 * @param {string} key The key to save under.
 * @param {string} value The value to save.
 */
async function saveToCache(key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}
