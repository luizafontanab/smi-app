-- adverts come in distinct paid formats (site advertising page specs)
alter table adverts add column format text not null default 'banner'
  check (format in ('banner', 'supplier_logo', 'newsletter_banner', 'association_logo'));
