export interface Filters {
  category: string;
  client: string;
  project: string;
  language: string;
}

export type ActiveTab = 'sessions' | 'insights' | 'settings' | 'faqs';

export interface ExternalNavLink {
  label: string;
  href: string;
}
