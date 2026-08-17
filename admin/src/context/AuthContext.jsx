import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [isAdmin, setIsAdmin] = useState(undefined); // undefined = flag not fetched yet

  async function loadAdminFlag(userId) {
    const { data } = await supabase.from('app_users').select('is_admin').eq('id', userId).single();
    setIsAdmin(!!data?.is_admin);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadAdminFlag(session.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        loadAdminFlag(session.user.id);
      } else {
        setIsAdmin(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const value = {
    session,
    isAdmin,
    // Both halves, or the console flashes "not authorized" at every admin: the session
    // resolves a round-trip before the is_admin lookup does, and a false default is
    // indistinguishable from a real denial until that query lands.
    loading: session === undefined || (!!session && isAdmin === undefined),
    login: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    // No callback route needed: supabase-js reads the session out of the URL on load and
    // fires onAuthStateChange, and Login already redirects once `session` is set. The
    // origin must be listed under Authentication -> URL Configuration -> Redirect URLs.
    //
    // shouldCreateUser: false is the security-relevant half. The default is true, which
    // would mint an account for any address typed into the box -- on a console whose
    // accounts are all created by an admin, sign-in must never be a sign-up.
    loginWithLink: (email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
      }),
    logout: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
