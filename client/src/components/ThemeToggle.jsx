import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider.jsx';
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return <button className="button button-ghost icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>;
}
