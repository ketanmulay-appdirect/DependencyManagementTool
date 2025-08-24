import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  ChevronRightIcon, 
  ChevronDownIcon,
  DocumentTextIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';
import { PackageManagerBadge } from '../VulnerabilityTable/PackageManagerBadge';

interface Dependency {
  name: string;
  version: string;
  type: 'direct' | 'transitive';
  packageManager: string;
  filePath: string;
  isDev: boolean;
  isVulnerable?: boolean;
}

interface PackageFile {
  filePath: string;
  packageManager: string;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DependencyTreeProps {
  dependencies: Dependency[];
  packageFiles: PackageFile[];
}

interface TreeNode {
  id: string;
  name: string;
  version: string;
  packageManager: string;
  filePath: string;
  isDev: boolean;
  isVulnerable: boolean;
  children: TreeNode[];
  isExpanded?: boolean;
}

export const DependencyTree: React.FC<DependencyTreeProps> = ({
  dependencies,
  packageFiles,
}) => {
  // Defensive programming - ensure props are arrays
  const safeDependencies = Array.isArray(dependencies) ? dependencies : [];
  const safePackageFiles = Array.isArray(packageFiles) ? packageFiles : [];
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedTab, setSelectedTab] = useState<'tree' | 'files'>('tree');
  const [filterVulnerable, setFilterVulnerable] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Group dependencies by package manager and build tree structure
  const dependencyTree = useMemo(() => {
    const grouped = safeDependencies.reduce((acc, dep) => {
      // Defensive programming - ensure dep object and required properties exist
      if (!dep || !dep.packageManager || !dep.name) {
        return acc;
      }
      
      const key = dep.packageManager;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push({
        id: `${dep.name}@${dep.version || 'unknown'}`,
        name: dep.name,
        version: dep.version || 'unknown',
        packageManager: dep.packageManager,
        filePath: dep.filePath || '',
        isDev: dep.isDev || false,
        isVulnerable: dep.isVulnerable || false,
        children: [],
      });
      return acc;
    }, {} as Record<string, TreeNode[]>);

    return grouped;
  }, [safeDependencies]);

  const filteredDependencies = useMemo(() => {
    let filtered = safeDependencies;

    if (filterVulnerable) {
      filtered = filtered.filter(dep => dep?.isVulnerable);
    }

    if (searchTerm) {
      filtered = filtered.filter(dep => 
        dep?.name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  }, [safeDependencies, filterVulnerable, searchTerm]);

  const stats = useMemo(() => {
    const total = safeDependencies.length;
    const vulnerable = safeDependencies.filter(d => d?.isVulnerable).length;
    const dev = safeDependencies.filter(d => d?.isDev).length;
    const prod = total - dev;
    const direct = safeDependencies.filter(d => d?.type === 'direct').length;
    const transitive = safeDependencies.filter(d => d?.type === 'transitive').length;

    return { total, vulnerable, dev, prod, direct, transitive };
  }, [safeDependencies]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const TreeNodeComponent: React.FC<{ 
    node: TreeNode; 
    level: number;
    isVisible: boolean;
  }> = ({ node, level, isVisible }) => {
    if (!isVisible) return null;

    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const paddingLeft = level * 20;

    return (
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div 
          className={`flex items-center py-2 px-3 hover:bg-gray-50 rounded cursor-pointer ${
            node.isVulnerable ? 'bg-red-50 border-l-2 border-red-300' : ''
          }`}
          style={{ paddingLeft: paddingLeft + 12 }}
          onClick={() => hasChildren && toggleNode(node.id)}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDownIcon className="h-4 w-4 text-gray-400 mr-2" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 text-gray-400 mr-2" />
            )
          ) : (
            <div className="w-4 mr-2" />
          )}
          
          <CubeIcon className={`h-4 w-4 mr-2 ${
            node.isVulnerable ? 'text-red-500' : 'text-gray-400'
          }`} />
          
          <div className="flex-1 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className={`font-medium ${
                node.isVulnerable ? 'text-red-700' : 'text-gray-900'
              }`}>
                {node.name}
              </span>
              <span className="text-sm text-gray-500 font-mono">
                v{node.version}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                dependencies.find(d => d.name === node.name)?.type === 'transitive'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-purple-100 text-purple-700'
              }`}>
                {dependencies.find(d => d.name === node.name)?.type || 'direct'}
              </span>
              {node.isDev && (
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                  dev
                </span>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <PackageManagerBadge manager={node.packageManager} size="sm" />
              {node.isVulnerable && (
                <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
              )}
            </div>
          </div>
        </div>
        
        {/* Render children if expanded */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => (
              <TreeNodeComponent
                key={child.id}
                node={child}
                level={level + 1}
                isVisible={true}
              />
            ))}
          </div>
        )}
      </motion.div>
    );
  };

  const PackageFileComponent: React.FC<{ packageFile: PackageFile }> = ({ packageFile }) => {
    const dependencyCount = Object.keys(packageFile.dependencies).length;
    const devDependencyCount = Object.keys(packageFile.devDependencies || {}).length;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <DocumentTextIcon className="h-5 w-5 text-gray-400" />
            <span className="font-medium text-gray-900">{packageFile.filePath}</span>
          </div>
          <PackageManagerBadge manager={packageFile.packageManager} />
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Dependencies:</span>
            <span className="font-medium text-gray-900 ml-2">{dependencyCount}</span>
          </div>
          <div>
            <span className="text-gray-600">Dev Dependencies:</span>
            <span className="font-medium text-gray-900 ml-2">{devDependencyCount}</span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Important Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <ShieldCheckIcon className="h-5 w-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm">
            <p className="text-blue-800 font-medium mb-1">Dependency Analysis Overview</p>
            <p className="text-blue-700">
              Showing <strong>{stats.direct} direct dependencies</strong> from package files and{' '}
              <strong>{stats.transitive} transitive dependencies</strong> from lock files when available.
              {stats.transitive === 0 && (
                <span className="block mt-1 text-blue-600">
                  💡 Add lock files (package-lock.json, yarn.lock, etc.) to your repository for complete transitive dependency analysis.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-purple-700">{stats.direct}</div>
          <div className="text-sm text-purple-600">Direct Dependencies</div>
        </div>
        <div className="bg-indigo-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-indigo-700">{stats.transitive}</div>
          <div className="text-sm text-indigo-600">Transitive Dependencies</div>
        </div>
        <div className="bg-red-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-red-700">{stats.vulnerable}</div>
          <div className="text-sm text-red-600">Vulnerable</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-700">{stats.dev}</div>
          <div className="text-sm text-blue-600">Development</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
        <div className="flex items-center space-x-4">
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => setSelectedTab('tree')}
              className={`px-4 py-2 text-sm font-medium ${
                selectedTab === 'tree'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:text-gray-900'
              }`}
            >
              Dependency Tree
            </button>
            <button
              onClick={() => setSelectedTab('files')}
              className={`px-4 py-2 text-sm font-medium ${
                selectedTab === 'files'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:text-gray-900'
              }`}
            >
              Package Files
            </button>
          </div>

          {selectedTab === 'tree' && (
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filterVulnerable}
                onChange={(e) => setFilterVulnerable(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="ml-2 text-sm text-gray-700">Show only vulnerable</span>
            </label>
          )}
        </div>

        {selectedTab === 'tree' && (
          <div className="flex items-center space-x-2">
            <input
              type="text"
              placeholder="Search dependencies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field w-64"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="border border-gray-200 rounded-lg">
        {selectedTab === 'tree' ? (
          <div className="p-4">
            {Object.keys(dependencyTree).length === 0 ? (
              <div className="text-center py-8">
                <CubeIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No Dependencies Found
                </h3>
                <p className="text-gray-600">
                  No dependencies were detected in this repository.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(dependencyTree).map(([packageManager, deps]) => (
                  <div key={packageManager}>
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                      <div className="flex items-center space-x-2">
                        <PackageManagerBadge manager={packageManager} />
                        <span className="font-medium text-gray-900">
                          {deps.length} dependencies
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          const allIds = deps.map(d => d.id);
                          const newExpanded = new Set(expandedNodes);
                          const shouldExpand = !allIds.every(id => newExpanded.has(id));
                          
                          allIds.forEach(id => {
                            if (shouldExpand) {
                              newExpanded.add(id);
                            } else {
                              newExpanded.delete(id);
                            }
                          });
                          setExpandedNodes(newExpanded);
                        }}
                        className="text-sm text-primary-600 hover:text-primary-700"
                      >
                        {deps.every(d => expandedNodes.has(d.id)) ? 'Collapse All' : 'Expand All'}
                      </button>
                    </div>
                    
                    <div className="space-y-1">
                      {deps
                        .filter(dep => !filterVulnerable || dep.isVulnerable)
                        .filter(dep => !searchTerm || dep.name.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map(dep => (
                          <TreeNodeComponent
                            key={dep.id}
                            node={dep}
                            level={0}
                            isVisible={true}
                          />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {safePackageFiles.length === 0 ? (
              <div className="text-center py-8">
                <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No Package Files Found
                </h3>
                <p className="text-gray-600">
                  No package manager files were detected in this repository.
                </p>
              </div>
            ) : (
              safePackageFiles.map((file, index) => (
                <PackageFileComponent key={index} packageFile={file} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}; 