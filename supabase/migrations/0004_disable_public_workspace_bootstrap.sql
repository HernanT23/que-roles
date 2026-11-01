-- The private single-owner workspace is provisioned. Disable tenant creation from the browser.
revoke all on function public.create_organization(text,text) from public, anon, authenticated;
