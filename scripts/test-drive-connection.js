#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var googleapis_1 = require("googleapis");
var dotenv_1 = require("dotenv");
var path = require("path");
// Cargar variables de entorno
var envPath = path.join(__dirname, '../.env.local');
(0, dotenv_1.config)({ path: envPath });
var getEnv = function (key) {
    var value = process.env[key];
    if (!value) {
        throw new Error("Missing environment variable: ".concat(key));
    }
    return value;
};
function testDriveConnection() {
    return __awaiter(this, void 0, void 0, function () {
        var keyBase64, keyJson, auth, drive, rootFolderId, rootFolder, testFolderName, folderMetadata, testFolder, testFile, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing Google Drive Connection...\n');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    // 1. Decodificar credenciales
                    console.log('1️⃣  Decoding service account credentials...');
                    keyBase64 = getEnv('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64');
                    keyJson = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf-8'));
                    console.log("   \u2705 Service Account: ".concat(keyJson.client_email, "\n"));
                    // 2. Autenticarse con Google Drive
                    console.log('2️⃣  Authenticating with Google Drive API...');
                    auth = new googleapis_1.google.auth.GoogleAuth({
                        credentials: keyJson,
                        scopes: ['https://www.googleapis.com/auth/drive'],
                    });
                    drive = googleapis_1.google.drive({ version: 'v3', auth: auth });
                    console.log('   ✅ Authentication successful\n');
                    rootFolderId = getEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
                    console.log("3\uFE0F\u20E3  Checking root folder access: ".concat(rootFolderId));
                    return [4 /*yield*/, drive.files.get({
                            fileId: rootFolderId,
                            fields: 'id, name, mimeType',
                        })];
                case 2:
                    rootFolder = _a.sent();
                    console.log("   \u2705 Root folder: \"".concat(rootFolder.data.name, "\"\n"));
                    // 4. Crear carpeta de prueba
                    console.log('4️⃣  Creating test folder...');
                    testFolderName = "Test-RDD-".concat(new Date().toISOString().split('T')[0]);
                    folderMetadata = {
                        name: testFolderName,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [rootFolderId],
                    };
                    return [4 /*yield*/, drive.files.create({
                            requestBody: folderMetadata,
                            fields: 'id, name, webViewLink',
                        })];
                case 3:
                    testFolder = _a.sent();
                    console.log("   \u2705 Test folder created!\n");
                    console.log("   \uD83D\uDCC1 Folder Name: ".concat(testFolder.data.name));
                    console.log("   \uD83D\uDCCC Folder ID:   ".concat(testFolder.data.id));
                    console.log("   \uD83D\uDD17 Drive Link:  ".concat(testFolder.data.webViewLink, "\n"));
                    // 5. Crear un archivo de prueba dentro
                    console.log('5️⃣  Creating test file inside folder...');
                    return [4 /*yield*/, drive.files.create({
                            requestBody: {
                                name: 'test-file.txt',
                                mimeType: 'text/plain',
                                parents: [testFolder.data.id],
                            },
                            media: {
                                mimeType: 'text/plain',
                                body: 'Test file created by RDD Agent\n' +
                                    "Created at: ".concat(new Date().toISOString(), "\n") +
                                    'If you see this, the service account has write access! ✅',
                            },
                            fields: 'id, name, webViewLink',
                        })];
                case 4:
                    testFile = _a.sent();
                    console.log("   \u2705 Test file created: \"".concat(testFile.data.name, "\"\n"));
                    // Resumen
                    console.log('═══════════════════════════════════════════════════');
                    console.log('✅ ALL TESTS PASSED!\n');
                    console.log('Your Google Drive configuration is working correctly.');
                    console.log('\n📋 Summary:');
                    console.log("  \u2022 Service Account: ".concat(keyJson.client_email));
                    console.log("  \u2022 Root Folder: ".concat(rootFolder.data.name, " (").concat(rootFolderId, ")"));
                    console.log("  \u2022 Test Folder: ".concat(testFolder.data.name));
                    console.log("  \u2022 Test Folder ID: ".concat(testFolder.data.id));
                    console.log('\n💡 Next Steps:');
                    console.log('  1. If you want a NEW folder for RDD (separate from SaaS):');
                    console.log("     Copy the folder ID: ".concat(testFolder.data.id));
                    console.log('     And set GOOGLE_DRIVE_ROOT_FOLDER_ID in .env.local');
                    console.log('\n  2. If you want to keep using the current folder:');
                    console.log('     No action needed - configuration is correct!');
                    console.log('\n═══════════════════════════════════════════════════\n');
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    console.error('❌ Error:', error_1 instanceof Error ? error_1.message : error_1);
                    console.error('\nℹ️  Troubleshooting:');
                    console.error('  • Check .env.local exists and has correct values');
                    console.error('  • Check service account has Drive API enabled');
                    console.error('  • Check folder ID is correct and accessible');
                    process.exit(1);
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
testDriveConnection();
