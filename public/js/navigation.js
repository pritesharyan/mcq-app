const menuToggle = document.getElementById('menuToggle');
const primaryNav = document.getElementById('primaryNav');
const navBackdrop = document.getElementById('navBackdrop');

function setNavigationOpen(isOpen, moveFocus = true) {
  const isMobile = window.matchMedia('(max-width: 760px)').matches;
  const drawerIsOpen = isMobile && isOpen;
  primaryNav.classList.toggle('drawer-open', drawerIsOpen);
  primaryNav.inert = isMobile && !drawerIsOpen;
  primaryNav.setAttribute('aria-hidden', String(isMobile && !drawerIsOpen));
  navBackdrop.classList.toggle('backdrop-visible', drawerIsOpen);
  document.body.classList.toggle('drawer-active', drawerIsOpen);
  menuToggle.setAttribute('aria-expanded', String(drawerIsOpen));
  menuToggle.setAttribute('aria-label', drawerIsOpen ? 'Close navigation' : 'Open navigation');
  menuToggle.title = drawerIsOpen ? 'Close navigation' : 'Open navigation';

  if (moveFocus && drawerIsOpen) primaryNav.querySelector('.tab-btn').focus();
  else if (moveFocus && isMobile) menuToggle.focus();
}

menuToggle.addEventListener('click', () => {
  setNavigationOpen(menuToggle.getAttribute('aria-expanded') !== 'true');
});
navBackdrop.addEventListener('click', () => setNavigationOpen(false));
primaryNav.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => setNavigationOpen(false));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') setNavigationOpen(false);
});
window.matchMedia('(min-width: 761px)').addEventListener('change', event => {
  if (event.matches) setNavigationOpen(false);
});
setNavigationOpen(false, false);