// App shell: the composition chrome every route renders inside — layout,
// sidebar/topbar navigation, search box, page-state renderers, and the
// sponsorship CTA. Catalog primitives live in components/ui/.
export { Layout } from './Layout.js';
export { Sidebar } from './Sidebar.js';
export { SidebarPlaylistItem } from './SidebarPlaylistItem.js';
export { TopBar } from './TopBar.js';
export { SearchBox } from './SearchBox.js';
export { BrandMark } from './BrandMark.js';
export { ErrorBoundary, reportClientError } from './ErrorBoundary.js';
export { SponsorButton } from './SponsorButton.js';
export { PageState } from './PageState.js';
export {
  EntityDetailSkeleton,
  GridPageSkeleton,
  ListPageSkeleton,
  PageSkeleton,
  QueuePanelSkeleton,
} from './Skeletons.js';
