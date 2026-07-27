import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getVisibleNavItems } from '../../constants/navItems';

export default function BottomNav() {
  const { isAdmin, isCommander } = useAuth();
  const visibleItems = getVisibleNavItems(isAdmin, isCommander);

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-3 safe-bottom">
      <div className="max-w-mobile mx-auto flex items-center justify-around bg-white/85 backdrop-blur-md border border-black/[0.06] rounded-full shadow-card-md py-1.5 px-1">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex flex-col items-center gap-1 px-2.5 py-1"
          >
            {({ isActive }) => (
              <>
                <span
                  className={`w-[26px] h-[26px] rounded-full flex items-center justify-center transition-colors ${
                    isActive ? 'bg-primary' : ''
                  }`}
                >
                  {item.icon(isActive)}
                </span>
                <span className={`text-[9.5px] ${isActive ? 'font-extrabold text-primary' : 'font-medium text-text-secondary'}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
