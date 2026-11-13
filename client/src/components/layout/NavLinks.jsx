import { NavLink } from 'react-router-dom';

/**
 * Shared Editor | Dashboard navigation (React Router).
 * `NavLink` applies `.active` automatically for styling.
 */
export default function NavLinks({ className = '' }) {
  return (
    <nav className={`route-nav ${className}`} aria-label="Primary">
      <NavLink to="/" end>Editor</NavLink>
      <NavLink to="/dashboard">Dashboard</NavLink>
      <NavLink to="/alerts">Alerts</NavLink>
    </nav>
  );
}
