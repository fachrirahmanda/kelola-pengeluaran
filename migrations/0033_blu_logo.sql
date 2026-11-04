-- blu's logo is now its own artwork (public/banks/blu.png, white) on the logo's teal, not the drawn one.
UPDATE banks SET logo = 'blu.png', color = '#30CED0' WHERE id = 'blu' AND logo = 'blu';
