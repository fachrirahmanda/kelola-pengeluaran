import { Icon } from './Icon';

// Categories store an emoji as their icon (CATEGORY_ICONS). Each one is drawn as a line icon from
// the app's set; an emoji outside that list still shows as itself.
const LINE_ICONS: Record<string, string> = {
  '🍜': 'bowl',
  '🚗': 'car',
  '🛒': 'cart',
  '💡': 'bulb',
  '🎬': 'film',
  '💊': 'pill',
  '📚': 'book',
  '💳': 'card',
  '🏠': 'home',
  '🎁': 'gift',
  '☕': 'coffee',
  '📦': 'box',
};

export function CategoryIcon({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  const name = icon ? LINE_ICONS[icon] : undefined;
  if (name) return <Icon name={name} size={size} />;
  return <>{icon}</>;
}
