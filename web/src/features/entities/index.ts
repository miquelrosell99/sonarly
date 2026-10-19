// Shared entity-display kit — the domain-level building blocks every
// library/entity surface composes from (cards, rows, covers, context menus,
// entity headers, filters). Catalog primitives live in components/ui/.
export { FavoriteButton, StarRating } from './ActionButtons.js';
export { ArtistImage } from './ArtistImage.js';
export { Avatar } from './Avatar.js';
export { Card, type CardActionFavorite, type CardActionPlay, type CardActionRating, type CardField } from './Card.js';
export { CoverArt } from './CoverArt.js';
export { EntityActionsMenu } from './EntityActionsMenu.js';
export { EntityDetail, type EntityDetailProps } from './EntityDetail.js';
export { EntityHeader } from './EntityHeader.js';
export { ExplicitTitle } from './ExplicitTitle.js';
export { FavoriteRatingGroup } from './FavoriteRatingGroup.js';
export {
  FilterPanel,
  type FilterDefinition,
  type FilterOption,
  type FilterType,
} from './FilterPanel.js';
export {
  ItemContextMenu,
  type ContextMenuItem,
  type ContextMenuSection,
} from './ItemContextMenu.js';
export { LibrarySelector } from './LibrarySelector.js';
export { ListRow, type ListRowActionFavorite, type ListRowActionRating } from './ListRow.js';
export { MetadataBreadcrumb, type MetadataItem } from './MetadataBreadcrumb.js';
export { ScrollRow } from './ScrollRow.js';
export { TrackActionsMenu } from './TrackActionsMenu.js';
