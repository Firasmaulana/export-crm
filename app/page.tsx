"use client";

import React from "react";
import AuthGate from "@/components/AuthGate";
import CrmDashboard from "@/components/CrmDashboard";

export default function HomePage() {
  return (
    <AuthGate>
      {(user, onSignOut) => <CrmDashboard user={user} onSignOut={onSignOut} />}
    </AuthGate>
  );
}
