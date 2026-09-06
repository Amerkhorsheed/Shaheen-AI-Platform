import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import ConfirmModal from '../components/ConfirmModal';

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    message: '',
    itemName: '',
    description: '',
    confirmText: 'تأكيد',
    cancelText: 'إلغاء الأمر',
    variant: 'danger',
    isAlert: false
  });

  const resolverRef = useRef(null);

  const confirm = useCallback(({
    title = 'تأكيد الإجراء',
    message = 'هل أنت متأكد من رغبتك في الاستمرار؟',
    itemName = '',
    description = '',
    confirmText = 'تأكيد',
    cancelText = 'إلغاء الأمر',
    variant = 'danger'
  } = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialogState({
        isOpen: true,
        title,
        message,
        itemName,
        description,
        confirmText,
        cancelText,
        variant,
        isAlert: false
      });
    });
  }, []);

  const alert = useCallback(({
    title = 'تنبيه',
    message = '',
    itemName = '',
    description = '',
    confirmText = 'حسناً',
    variant = 'warning'
  } = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialogState({
        isOpen: true,
        title,
        message,
        itemName,
        description,
        confirmText,
        cancelText: '',
        variant,
        isAlert: true
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    setDialogState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleConfirm = useCallback(() => {
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
    setDialogState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      <ConfirmModal
        isOpen={dialogState.isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={dialogState.title}
        message={dialogState.message}
        itemName={dialogState.itemName}
        description={dialogState.description}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        variant={dialogState.variant}
        isAlert={dialogState.isAlert}
      />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}
