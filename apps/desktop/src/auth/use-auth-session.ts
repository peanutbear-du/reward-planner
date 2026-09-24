import type { Session, Subscription } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { restoreSession, subscribeToAuthState } from "./auth-service";

interface AuthSessionState {
  error: string | null;
  isLoading: boolean;
  session: Session | null;
}

const initialState: AuthSessionState = {
  error: null,
  isLoading: true,
  session: null,
};

export function useAuthSession() {
  const [state, setState] = useState<AuthSessionState>(initialState);

  useEffect(() => {
    let isActive = true;
    let subscription: Subscription | undefined;

    void Promise.resolve()
      .then(() => {
        if (!isActive) {
          return null;
        }

        subscription = subscribeToAuthState((_event, session) => {
          if (!isActive) {
            return;
          }

          setState({ error: null, isLoading: false, session });
        });

        return restoreSession();
      })
      .then((result) => {
        if (!isActive || !result) {
          return;
        }

        setState({
          error: result.error?.message ?? null,
          isLoading: false,
          session: result.data.session,
        });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setState({
          error: getErrorMessage(error),
          isLoading: false,
          session: null,
        });
      });

    return () => {
      isActive = false;
      subscription?.unsubscribe();
    };
  }, []);

  return state;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to restore the session.";
}
