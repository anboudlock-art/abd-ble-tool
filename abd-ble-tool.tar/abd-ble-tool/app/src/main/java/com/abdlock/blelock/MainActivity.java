package com.abdlock.blelock;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * ABD Bluetooth Lock Password Tool
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "ABDLock";
    
    // BLE UUID
    private static final UUID SERVICE_UUID = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB");
    private static final UUID WRITE_UUID = UUID.fromString("0000FFF2-0000-1000-8000-00805F9B34FB");
    private static final UUID NOTIFY_UUID = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB");
    private static final UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

    // Commands
    private static final int CMD_CONNECT = 0x10;
    private static final int CMD_PASSWORD_VERIFY = 0x20;
    private static final int CMD_PASSWORD_SET = 0x21;

    private static final int REQUEST_PERMISSIONS = 100;

    // UI
    private EditText etOldPassword;
    private EditText etNewPassword;
    private EditText etConfirmPassword;
    private Button btnScan;
    private Button btnChangePassword;
    private TextView tvStatus;
    private TextView tvLog;
    
    private AlertDialog scanDialog;
    private DeviceAdapter deviceAdapter;
    private List<BluetoothDevice> devices = new ArrayList<>();

    // Bluetooth
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bleScanner;
    private BluetoothGatt bluetoothGatt;
    private BluetoothGattCharacteristic writeCharacteristic;
    private BluetoothGattCharacteristic notifyCharacteristic;

    // State
    private byte cmdId = 0;
    private byte[] aesKey1 = new byte[16];
    private byte[] aesKey2 = new byte[16];
    private boolean isConnected = false;
    private String pendingNewPassword = null;

    private Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        initBluetooth();
        checkPermissions();
    }

    private void initViews() {
        etOldPassword = findViewById(R.id.et_old_password);
        etNewPassword = findViewById(R.id.et_new_password);
        etConfirmPassword = findViewById(R.id.et_confirm_password);
        btnScan = findViewById(R.id.btn_scan);
        btnChangePassword = findViewById(R.id.btn_change_password);
        tvStatus = findViewById(R.id.tv_status);
        tvLog = findViewById(R.id.tv_log);

        etOldPassword.setText("000000");

        btnScan.setOnClickListener(v -> startScan());
        btnChangePassword.setOnClickListener(v -> changePassword());

        btnChangePassword.setEnabled(false);
    }

    private void initBluetooth() {
        BluetoothManager bluetoothManager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager == null) {
            showToast("Cannot get Bluetooth Manager");
            return;
        }
        
        bluetoothAdapter = bluetoothManager.getAdapter();
        if (bluetoothAdapter == null) {
            showToast("Device does not support Bluetooth");
            return;
        }

        if (!bluetoothAdapter.isEnabled()) {
            showToast("Please enable Bluetooth");
            return;
        }

        bleScanner = bluetoothAdapter.getBluetoothLeScanner();
    }

    private void checkPermissions() {
        List<String> permissions = new ArrayList<>();
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }
        
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }

        if (!permissions.isEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toArray(new String[0]), REQUEST_PERMISSIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_PERMISSIONS) {
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (!allGranted) {
                showToast("Please grant Bluetooth permissions");
            }
        }
    }

    private void startScan() {
        if (bleScanner == null) {
            showToast("Bluetooth not initialized");
            return;
        }

        devices.clear();
        deviceAdapter = new DeviceAdapter();
        
        View dialogView = getLayoutInflater().inflate(R.layout.dialog_device_list, null);
        ListView listView = dialogView.findViewById(R.id.device_list_view);
        listView.setAdapter(deviceAdapter);
        listView.setOnItemClickListener((parent, view, position, id) -> {
            BluetoothDevice device = devices.get(position);
            stopScan();
            if (scanDialog != null) {
                scanDialog.dismiss();
            }
            connectToDevice(device);
        });

        scanDialog = new AlertDialog.Builder(this)
            .setTitle("Scanning...")
            .setView(dialogView)
            .setNegativeButton("Cancel", (dialog, which) -> {
                stopScan();
                dialog.dismiss();
            })
            .create();
        scanDialog.show();

        updateStatus("Scanning...");
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
            bleScanner.startScan(scanCallback);
        }

        handler.postDelayed(this::stopScan, 10000);
    }

    private void stopScan() {
        if (bleScanner != null && ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
            bleScanner.stopScan(scanCallback);
        }
        if (scanDialog != null) {
            scanDialog.setTitle("Scan Complete (tap to connect)");
        }
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            if (ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                String name = device.getName();
                if (name != null && !name.isEmpty() && !containsDevice(device)) {
                    if (name.toUpperCase().startsWith("LOCK_")) {
                        devices.add(device);
                        deviceAdapter.notifyDataSetChanged();
                    }
                }
            }
        }
    };

    private boolean containsDevice(BluetoothDevice device) {
        for (BluetoothDevice d : devices) {
            if (d.getAddress().equals(device.getAddress())) {
                return true;
            }
        }
        return false;
    }

    private void connectToDevice(BluetoothDevice device) {
        updateStatus("Connecting: " + device.getName());
        logData("Connecting: " + device.getName() + " [" + device.getAddress() + "]");
        
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
            bluetoothGatt = device.connectGatt(this, false, gattCallback);
        }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                runOnUiThread(() -> {
                    updateStatus("Connected, discovering services...");
                    logData("Connected, discovering services...");
                });
                if (ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                    gatt.discoverServices();
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                runOnUiThread(() -> {
                    updateStatus("Disconnected");
                    logData("Disconnected");
                    isConnected = false;
                    btnChangePassword.setEnabled(false);
                });
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                BluetoothGattService service = gatt.getService(SERVICE_UUID);
                if (service != null) {
                    writeCharacteristic = service.getCharacteristic(WRITE_UUID);
                    notifyCharacteristic = service.getCharacteristic(NOTIFY_UUID);

                    if (writeCharacteristic != null && notifyCharacteristic != null) {
                        if (ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                            gatt.setCharacteristicNotification(notifyCharacteristic, true);
                            BluetoothGattDescriptor descriptor = notifyCharacteristic.getDescriptor(CCCD_UUID);
                            if (descriptor != null) {
                                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                                gatt.writeDescriptor(descriptor);
                            }
                        }

                        runOnUiThread(() -> {
                            String deviceName = gatt.getDevice().getName();
                            String deviceAddr = gatt.getDevice().getAddress();
                            updateStatus("Connected: " + deviceName);
                            logData("Service discovered");
                            logData("Device: " + deviceName);
                            logData("Address: " + deviceAddr);
                            isConnected = true;
                            initAesKey(deviceAddr);
                            btnChangePassword.setEnabled(true);
                        });
                    } else {
                        runOnUiThread(() -> {
                            logData("Error: Write/Notify characteristic not found");
                        });
                    }
                } else {
                    runOnUiThread(() -> {
                        logData("Error: Service FFF0 not found");
                    });
                }
            }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            runOnUiThread(() -> {
                logData("Notification enabled");
            });
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            byte[] data = characteristic.getValue();
            runOnUiThread(() -> {
                logData("Received: " + bytesToHex(data));
                handleReceivedData(data);
            });
        }
    };

    private void initAesKey(String macAddress) {
        String[] macParts = macAddress.split(":");
        byte[] deviceMac = new byte[6];
        for (int i = 0; i < 6; i++) {
            deviceMac[5 - i] = (byte) Integer.parseInt(macParts[i], 16);
        }

        System.arraycopy(deviceMac, 0, aesKey1, 0, 6);
        System.arraycopy(deviceMac, 0, aesKey2, 0, 6);
        aesKey1[6] = 0x11;
        aesKey2[6] = 0x11;

        for (int i = 0; i < 9; i++) {
            aesKey1[i + 7] = (byte) (aesKey1[i + 6] + 0x11);
            aesKey2[i + 7] = (byte) (aesKey2[i + 6] + 0x11);
        }

        logData("AES Key initialized");
    }

    private void changePassword() {
        String oldPassword = etOldPassword.getText().toString().trim();
        String newPassword = etNewPassword.getText().toString().trim();
        String confirmPassword = etConfirmPassword.getText().toString().trim();

        if (!validateInput(oldPassword, newPassword, confirmPassword)) {
            return;
        }

        pendingNewPassword = newPassword;
        sendConnectCommand();
    }

    private boolean validateInput(String oldPassword, String newPassword, String confirmPassword) {
        if (oldPassword.length() != 6) {
            showToast("Old password must be 6 digits");
            return false;
        }

        if (newPassword.length() != 6) {
            showToast("New password must be 6 digits");
            return false;
        }

        if (!newPassword.equals(confirmPassword)) {
            showToast("New passwords do not match");
            return false;
        }

        if (oldPassword.equals(newPassword)) {
            showToast("New password must be different");
            return false;
        }

        try {
            Long.parseLong(newPassword);
            Long.parseLong(oldPassword);
        } catch (NumberFormatException e) {
            showToast("Password must be digits only");
            return false;
        }

        return true;
    }

    private void sendConnectCommand() {
        logData("=== Step 1: Connect Verification ===");

        java.util.Calendar cal = java.util.Calendar.getInstance();
        int year = cal.get(java.util.Calendar.YEAR) - 2000;
        int month = cal.get(java.util.Calendar.MONTH) + 1;
        int day = cal.get(java.util.Calendar.DAY_OF_MONTH);
        int hour = cal.get(java.util.Calendar.HOUR_OF_DAY);
        int minute = cal.get(java.util.Calendar.MINUTE);
        int second = cal.get(java.util.Calendar.SECOND);

        byte[] data = new byte[10];
        data[0] = 0x55;
        data[1] = getCmdId();
        data[2] = CMD_CONNECT;
        data[3] = (byte) year;
        data[4] = (byte) month;
        data[5] = (byte) day;
        data[6] = (byte) hour;
        data[7] = (byte) minute;
        data[8] = (byte) second;
        data[9] = checksum(data, 1, 8);

        logData("Send connect: " + bytesToHex(data));

        aesKey2[10] = (byte) year;
        aesKey2[11] = (byte) month;
        aesKey2[12] = (byte) day;
        aesKey2[13] = (byte) hour;
        aesKey2[14] = (byte) minute;
        aesKey2[15] = (byte) second;

        sendEncryptedData(data, aesKey1);
    }

    private void sendPasswordVerifyCommand() {
        logData("=== Step 2: Verify Old Password ===");

        String oldPassword = etOldPassword.getText().toString().trim();
        byte[] password = parsePassword(oldPassword);

        byte[] data = new byte[10];
        data[0] = 0x55;
        data[1] = getCmdId();
        data[2] = CMD_PASSWORD_VERIFY;
        data[3] = password[0];
        data[4] = password[1];
        data[5] = password[2];
        data[6] = password[3];
        data[7] = password[4];
        data[8] = password[5];
        data[9] = checksum(data, 1, 8);

        logData("Send verify: " + bytesToHex(data));
        sendEncryptedData(data, aesKey2);
    }

    private void sendPasswordSetCommand() {
        logData("=== Step 3: Set New Password ===");

        if (pendingNewPassword == null) {
            showToast("Error: No new password");
            return;
        }

        byte[] password = parsePassword(pendingNewPassword);

        byte[] data = new byte[10];
        data[0] = 0x55;
        data[1] = getCmdId();
        data[2] = CMD_PASSWORD_SET;
        data[3] = password[0];
        data[4] = password[1];
        data[5] = password[2];
        data[6] = password[3];
        data[7] = password[4];
        data[8] = password[5];
        data[9] = checksum(data, 1, 8);

        logData("Send set password: " + bytesToHex(data));
        logData("New password: " + pendingNewPassword);
        sendEncryptedData(data, aesKey2);
    }

    private void handleReceivedData(byte[] encryptedData) {
        logData("Received: " + bytesToHex(encryptedData));

        byte[] decrypted = aesDecrypt(encryptedData, aesKey2);
        if (decrypted == null) {
            decrypted = aesDecrypt(encryptedData, aesKey1);
        }

        if (decrypted == null) {
            logData("Decrypt failed");
            return;
        }

        logData("Decrypted: " + bytesToHex(decrypted));

        if (decrypted[0] != (byte) 0xFB) {
            logData("Frame header error");
            return;
        }

        int len = decrypted[1] & 0xFF;
        if (len < 4) {
            logData("Data length error");
            return;
        }
        
        byte[] payload = new byte[len];
        System.arraycopy(decrypted, 2, payload, 0, len);

        if (payload[0] != (byte) 0xAA) {
            logData("Response header error");
            return;
        }

        int cmd = payload[2] & 0xFF;
        int result = payload.length > 3 ? (payload[3] & 0xFF) : 0;

        switch (cmd) {
            case CMD_CONNECT:
                logData("Connect response: Success");
                sendPasswordVerifyCommand();
                break;

            case CMD_PASSWORD_VERIFY:
                if (result == 0x00) {
                    logData("Old password: Correct");
                    sendPasswordSetCommand();
                } else {
                    logData("Old password: Wrong");
                    showToast("Old password is incorrect");
                }
                break;

            case CMD_PASSWORD_SET:
                if (result == 0x00) {
                    logData("New password: Set successfully");
                    showToast("Password changed successfully!");
                    logData("=== Password Change Complete ===");
                    pendingNewPassword = null;
                } else {
                    logData("New password: Set failed (error: " + result + ")");
                    showToast("Failed to set password");
                }
                break;

            default:
                logData("Unknown command: " + String.format("%02X", cmd));
                break;
        }
    }

    private void sendEncryptedData(byte[] data, byte[] key) {
        if (bluetoothGatt == null || writeCharacteristic == null) {
            logData("Error: Not connected");
            return;
        }

        byte[] frame = new byte[16];
        frame[0] = (byte) 0xFB;
        frame[1] = (byte) data.length;
        System.arraycopy(data, 0, frame, 2, data.length);

        for (int i = 2 + data.length; i < 16; i++) {
            frame[i] = (byte) 0xFC;
        }

        byte[] encrypted = aesEncrypt(frame, key);
        if (encrypted == null) {
            logData("Encryption failed");
            return;
        }

        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
            writeCharacteristic.setValue(encrypted);
            bluetoothGatt.writeCharacteristic(writeCharacteristic);
            logData("Sent: " + bytesToHex(encrypted));
        }
    }

    private byte[] aesEncrypt(byte[] data, byte[] key) {
        try {
            SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keySpec);
            return cipher.doFinal(data);
        } catch (Exception e) {
            Log.e(TAG, "AES encrypt failed: " + e.getMessage());
            return null;
        }
    }

    private byte[] aesDecrypt(byte[] data, byte[] key) {
        try {
            SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keySpec);
            return cipher.doFinal(data);
        } catch (Exception e) {
            Log.e(TAG, "AES decrypt failed: " + e.getMessage());
            return null;
        }
    }

    private byte[] parsePassword(String passwordStr) {
        byte[] password = new byte[6];
        for (int i = 0; i < 6; i++) {
            password[i] = (byte) (passwordStr.charAt(i) - '0');
        }
        return password;
    }

    private byte getCmdId() {
        return ++cmdId;
    }

    private byte checksum(byte[] data, int start, int length) {
        int sum = 0;
        for (int i = start; i < start + length; i++) {
            sum += data[i];
        }
        return (byte) (sum & 0xFF);
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X ", b));
        }
        return sb.toString().trim();
    }

    private void updateStatus(String status) {
        tvStatus.setText("Status: " + status);
    }

    private void logData(String msg) {
        String currentLog = tvLog.getText().toString();
        String newLog = currentLog + "\n" + msg;
        if (newLog.length() > 5000) {
            newLog = newLog.substring(newLog.length() - 5000);
        }
        tvLog.setText(newLog);
        Log.d(TAG, msg);
    }

    private void showToast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (bluetoothGatt != null) {
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
            }
        }
    }

    private class DeviceAdapter extends BaseAdapter {
        @Override
        public int getCount() {
            return devices.size();
        }

        @Override
        public Object getItem(int position) {
            return devices.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            if (convertView == null) {
                convertView = LayoutInflater.from(MainActivity.this)
                    .inflate(android.R.layout.simple_list_item_2, parent, false);
            }
            
            BluetoothDevice device = devices.get(position);
            TextView text1 = convertView.findViewById(android.R.id.text1);
            TextView text2 = convertView.findViewById(android.R.id.text2);
            
            if (ActivityCompat.checkSelfPermission(MainActivity.this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                text1.setText(device.getName() != null ? device.getName() : "Unknown");
                text2.setText(device.getAddress());
            }
            
            return convertView;
        }
    }
}
