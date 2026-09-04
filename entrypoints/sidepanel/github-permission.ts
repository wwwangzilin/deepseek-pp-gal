export async function requestGitHubApiPermission(): Promise<boolean> {
  return requestGitHubHostPermissions([
    'https://api.github.com/*',
    'https://raw.githubusercontent.com/*',
  ]);
}

export async function requestGitHubProjectImportPermission(): Promise<boolean> {
  return requestGitHubHostPermissions([
    'https://api.github.com/*',
    'https://raw.githubusercontent.com/*',
  ]);
}

async function requestGitHubHostPermissions(origins: string[]): Promise<boolean> {
  if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;
  const granted = await chrome.permissions.contains({ origins }).catch(() => false);
  if (granted) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}
