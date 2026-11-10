-- The card is William's CIBC Mastercard, never BMO (11-10). One row, its journal lines keep their account id.
UPDATE books.accounts SET key = 'card-cibc', name = 'CIBC Mastercard'
WHERE key = 'card-bmo' AND NOT EXISTS (SELECT 1 FROM books.accounts WHERE key = 'card-cibc');
