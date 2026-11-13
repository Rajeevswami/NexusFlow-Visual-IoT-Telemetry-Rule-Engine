import { createContext, useContext, useEffect, useState } from 'react';
const ThemeContext = createContext(null);
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('nexusflow-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('nexusflow-theme', theme); } catch { /* storage may be unavailable */ }
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme((current) => current === 'light' ? 'dark' : 'light') }}>{children}</ThemeContext.Provider>;
}
export function useTheme() { return useContext(ThemeContext) ?? { theme: 'light', toggleTheme: () => {} }; }
