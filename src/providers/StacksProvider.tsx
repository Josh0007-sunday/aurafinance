import { type FC, type ReactNode } from 'react';
import { Connect } from '@stacks/connect-react';

export const StacksProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const authOptions = {
        appDetails: {
            name: 'Aura Bridge',
            icon: window.location.origin + '/logo.png',
        },
        userSession: undefined, // Will be managed by Connect internally if not provided
        onFinish: () => {
            window.location.reload();
        },
        onCancel: () => {
            console.log('Stacks login cancelled');
        },
    };

    return (
        <Connect authOptions={authOptions}>
            {children}
        </Connect>
    );
};
